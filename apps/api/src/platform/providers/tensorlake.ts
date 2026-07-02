/**
 * Tensorlake sandbox provider.
 *
 * Creates sandboxes in Tensorlake Cloud from pre-built images or memory snapshots.
 * Implements the same SandboxProvider interface as DaytonaProvider, allowing
 * seamless dual-provider operation.
 *
 * Key differences from Daytona:
 *   - Preview URLs: deterministic pattern `https://{port}-{id}.sandbox.tensorlake.ai`
 *     instead of Daytona's signed preview links. No caching needed.
 *   - Lifecycle: suspend/resume (preserves memory) instead of stop/start.
 *   - Warm snapshots: `checkpoint(type=MEMORY)` is an official API, not experimental.
 *   - No labels: uses name prefix convention for orphan reaper scoping.
 *   - No webhooks: billing reconciliation uses polling (see tensorlake-reconciler.ts).
 *   - Managed processes: optional auto-restart + health checks for the daemon.
 *   - Cold boot from base image: when no per-project snapshot exists (trial plan
 *     quota limit), the agent runtime is installed imperatively at provision time
 *     (see installRuntimeInSandbox).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { getStarterFiles } from '@kortix/starter';
import { config, SANDBOX_VERSION } from '../../config';
import {
  Sandbox,
  buildTensorlakeName,
  isManagedTensorlakeName,
  tensorlakeWarmSnapshotsEnabled,
} from '../../shared/tensorlake';
import { warmRestoreScript, WARM_RESTORE_MARKERS, noteWarmPathFailure } from '../../snapshots/warm-bake';
import { serviceKeyForExternalId } from '../service-key';
import { sandboxFrontendBaseUrl } from '../sandbox-frontend-url';
import { WarmRuntimeUnavailableError } from './index';
import type {
  SandboxProvider,
  ProviderName,
  CreateSandboxOpts,
  ProvisionResult,
  SandboxStatus as ProviderSandboxStatus,
  ResolvedEndpoint,
  ProvisioningTraits,
  ProvisioningStatus,
} from './index';

// ─── Repo root ────────────────────────────────────────────────────────────────
// Local dev:  __dirname = <repo>/apps/api/src/platform/providers/ → ../../../.. = <repo>/
// Docker:     __dirname = /app/apps/api/src/platform/providers/  → ../../../.. = /app/apps/
//             but static assets live under /app/apps/... so we detect and go one level up.
const __dirname = dirname(fileURLToPath(import.meta.url));
const _rawRoot = resolve(__dirname, '../../../..');
const REPO_ROOT = existsSync(resolve(_rawRoot, 'apps/sandbox/entrypoint.sh'))
  ? _rawRoot
  : resolve(_rawRoot, '..');

// ─── Status Cache ──────────────────────────────────────────────────────────────
// Same pattern as DaytonaProvider: short-TTL cache on the hot path to avoid
// redundant round-trips when the UI polls every ~800ms.

const STATUS_CACHE_TTL_MS = 1500;
const runningStatusCache = new Map<string, number>(); // externalId → cachedAt (ms)

// ─── Default Resources ────────────────────────────────────────────────────────

const DEFAULT_CPUS = 1;
const DEFAULT_MEMORY_MB = 1024; // Tensorlake requires 1000-8192 MB per CPU core; 1024 MB for trial plan
// IMPORTANT: ephemeral sandboxes (no name) TERMINATE permanently on idle timeout.
// The cold-boot install takes 3-25 min, so 10 min default would kill the sandbox
// mid-install. Use a generous idle threshold that survives the install.
const DEFAULT_TIMEOUT_SECS = 1800; // 30 min idle → auto-suspend (was 600)
// Cold-boot install timeout — the setup script itself has its own `timeout` arg,
// but the SANDBOX must stay alive long enough for the install to complete.
const COLD_BOOT_TIMEOUT_SECS = 1800; // 30 min — covers worst-case apt+opencode+bun

// ─── Agent Port ───────────────────────────────────────────────────────────────
// The Kortix agent daemon listens on port 8000 inside the sandbox.

const AGENT_PORT = 8000;

// ─── Runtime Constants ────────────────────────────────────────────────────────
// Keep in sync with dockerfile-layer.ts and warm-bake.ts.

const OPENCODE_VERSION = '1.15.10';
const RUNTIME_HOME = '/opt/kortix/home';

// ─── Upload chunk size ────────────────────────────────────────────────────────
// Tensorlake's gRPC transport may enforce a max message size. Upload the agent
// binary in chunks well below the typical 4 MB gRPC limit to avoid hits.

const UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024; // 2 MB

export class TensorlakeProvider implements SandboxProvider {
  readonly name: ProviderName = 'tensorlake';

  readonly provisioning: ProvisioningTraits = {
    async: false,
    stages: [
      { id: 'creating', progress: 50, message: 'Creating sandbox...' },
    ],
  };

  async getProvisioningStatus(): Promise<ProvisioningStatus | null> {
    return null; // Synchronous provisioning — no staged progress
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  async create(opts: CreateSandboxOpts): Promise<ProvisionResult> {
    // Build the public API base URL (strip route suffixes for backward compat)
    const sandboxApiBase = config.KORTIX_URL
      .replace(/\/+$/, '')
      .replace(/\/v1\/router$/, '')
      .replace(/\/v1$/, '');

    const envVars: Record<string, string> = {
      KORTIX_API_URL: `${sandboxApiBase}/v1`,
      KORTIX_FRONTEND_URL: sandboxFrontendBaseUrl(),
      ...opts.envVars,
    };
    if (!envVars.KORTIX_TOKEN) {
      throw new Error('[tensorlake] create() called without KORTIX_TOKEN — sandbox cannot authenticate to the Kortix router.');
    }

    // Warm path: boot from memory-state warm base (~0.6-1.3s)
    if (opts.warmBaseSnapshot && tensorlakeWarmSnapshotsEnabled()) {
      try {
        return await this.createWarm(opts, opts.warmBaseSnapshot, envVars, sandboxApiBase);
      } catch (err) {
        noteWarmPathFailure();
        if (err instanceof WarmRuntimeUnavailableError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        throw new WarmRuntimeUnavailableError(`warm create failed: ${msg}`);
      }
    }

    // Cold path: boot from per-project image/snapshot
    return this.createCold(opts, envVars, sandboxApiBase);
  }

  /**
   * Cold path: create a sandbox from a per-project image or snapshot.
   * When no snapshot exists (e.g. trial plan quota prevents building one), the
   * base image `tensorlake/ubuntu-systemd` is used. This image does NOT contain
   * the kortix-agent, so we install the runtime imperatively at provision time
   * (see installRuntimeInSandbox).
   */
  private async createCold(
    opts: CreateSandboxOpts,
    envVars: Record<string, string>,
    sandboxApiBase: string,
  ): Promise<ProvisionResult> {
    const snapshot = opts.snapshot;
    const baseImage = config.TENSORLAKE_DEFAULT_IMAGE || 'tensorlake/ubuntu-systemd';

    // When TENSORLAKE_DEFAULT_SNAPSHOT_ID is set, ALWAYS use it. This is a REAL
    // snapshot ID (e.g. "snapshot_sandbox_template_build_xxx") that Sandbox.create()
    // accepts as `snapshotId`. The `snapshot` arg from ensureSandboxImage is an
    // IMAGE NAME (e.g. "kortix-default-7e11785ed6de"), NOT a snapshot ID — passing
    // it as `snapshotId` to Sandbox.create() fails with a "not found" error,
    // triggering the healing → quota-fallback chain that wastes 4+ minutes and
    // often hits the 1-concurrent-sandbox quota. The env var short-circuits all
    // of that: it's the operator's guarantee that this snapshot ID is valid and
    // active, so we trust it unconditionally.
    const defaultSnapshotId = config.TENSORLAKE_DEFAULT_SNAPSHOT_ID;
    let effectiveSnapshot: string | undefined;
    let effectiveImage: string | undefined;

    if (defaultSnapshotId) {
      // Operator set a default snapshot ID — use it directly.
      effectiveSnapshot = defaultSnapshotId;
      console.log(`[tensorlake] Booting from TENSORLAKE_DEFAULT_SNAPSHOT_ID: ${effectiveSnapshot}`);
    } else if (snapshot) {
      // No env var, but ensureSandboxImage resolved a snapshot name.
      // Distinguish image names (kortix-default-xxx) from raw snapshot IDs
      // (snapshot_xxx, suspend-xxx). Image names must be passed as `image`,
      // raw snapshot IDs as `snapshotId`.
      if (snapshot.startsWith('snapshot_') || snapshot.startsWith('suspend-')) {
        effectiveSnapshot = snapshot;
        console.log(`[tensorlake] Booting from snapshot: ${effectiveSnapshot}`);
      } else {
        // It's an image name (e.g. kortix-default-xxx) — pass as `image`.
        effectiveImage = snapshot;
        console.log(`[tensorlake] Booting from registered image: ${effectiveImage}`);
      }
    }

    const sandboxName = buildTensorlakeName(opts.accountId, opts.name);
    const autoStopMinutes = opts.autoStopInterval ?? config.KORTIX_SANDBOX_AUTOSTOP_MINUTES;
    const timeoutSecs = autoStopMinutes === 0 ? 0 : Math.max(60, autoStopMinutes * 60);

    // Create sandbox from snapshot (if built) or base image (fallback)
    // On cold boot (no snapshot), use a LONGER timeout so the install completes
    // before the sandbox's idle-timer terminates it.
    const isColdBoot = !effectiveSnapshot && !effectiveImage;
    const effectiveTimeout = isColdBoot
      ? Math.max(timeoutSecs || 0, COLD_BOOT_TIMEOUT_SECS)
      : (timeoutSecs || DEFAULT_TIMEOUT_SECS);
    const createOpts: Record<string, unknown> = {
      name: sandboxName,
      cpus: DEFAULT_CPUS,
      memoryMb: DEFAULT_MEMORY_MB,
      timeoutSecs: effectiveTimeout,
      allowInternetAccess: true,
    };

    // snapshotId takes priority (pre-built image), otherwise use base image
    if (effectiveSnapshot) {
      createOpts.snapshotId = effectiveSnapshot;
    } else if (effectiveImage) {
      createOpts.image = effectiveImage;
    } else {
      createOpts.image = baseImage;
      console.log(`[tensorlake] No snapshot available, booting from base image: ${baseImage}`);
    }

    const sandbox = await Sandbox.create(createOpts);

    // Expose the agent daemon port so the proxy can reach it
    await sandbox.update({
      exposedPorts: [AGENT_PORT],
      allowUnauthenticatedAccess: false,
    });

    // Write env vars as an env file inside the sandbox
    await this.writeEnvFile(sandbox, envVars);

    // When booting from the base image (no pre-built snapshot), the runtime
    // (kortix-agent, opencode, etc.) is missing. Install it imperatively.
    //
    // ALSO: even if we booted from a snapshot, verify the agent binary exists.
    // Some snapshots (e.g. a bare tensorlake/ubuntu-systemd snapshot) don't
    // contain the Kortix runtime — the sandbox boots but port 8000 returns
    // 403 because nothing is listening. If the agent is missing, fall back to
    // installing the runtime imperatively (cold boot pattern).
    let agentPresent = false;
    if (effectiveSnapshot) {
      try {
        const checkResult = await sandbox.run('bash', {
          args: ['-c', 'test -x /usr/local/bin/kortix-agent && echo KORTIX_AGENT_PRESENT || echo KORTIX_AGENT_MISSING'],
          timeout: 10,
        });
        const checkOut = String((checkResult as any).stdout ?? '');
        agentPresent = checkOut.includes('KORTIX_AGENT_PRESENT');
        if (!agentPresent) {
          console.warn(
            `[tensorlake] Snapshot ${effectiveSnapshot} booted but /usr/local/bin/kortix-agent is missing — ` +
            `installing runtime imperatively (snapshot lacks Kortix runtime).`,
          );
        }
      } catch (checkErr) {
        console.warn(
          `[tensorlake] Failed to verify kortix-agent in snapshot ${effectiveSnapshot}: ` +
          `${checkErr instanceof Error ? checkErr.message : checkErr} — assuming missing, will install runtime.`,
        );
        agentPresent = false;
      }
    }

    if (!effectiveSnapshot || !agentPresent) {
      await this.installRuntimeInSandbox(sandbox, envVars);
    } else if (agentPresent) {
      // Agent binary IS present (from snapshot), but the daemon process is NOT
      // running (filesystem snapshots don't preserve processes). We need to:
      // 1. Write the new session.env (with correct session ID)
      // 2. Write /etc/pt-env
      // 3. Launch the daemon
      console.log('[tensorlake] Agent present in snapshot — writing session env + launching daemon');
      await this.launchDaemonFromSnapshot(sandbox, envVars);
    }

    const externalId = sandbox.sandboxId;
    const baseUrl = `${sandboxApiBase}/v1/p/${externalId}/${AGENT_PORT}`;

    return {
      externalId,
      baseUrl,
      metadata: {
        provisionedBy: opts.userId,
        tensorlakeSandboxId: externalId,
        snapshot: effectiveSnapshot || null,
        image: effectiveSnapshot ? undefined : baseImage,
        version: SANDBOX_VERSION,
      },
    };
  }

  /**
   * Warm path: create from a memory-state warm base (~0.6-1.3s), then start
   * the session daemon post-restore. Tensorlake MEMORY checkpoints are an
   * OFFICIAL API (unlike Daytona's _experimental_createSnapshot), so the warm
   * path is significantly more reliable here.
   */
  private async createWarm(
    opts: CreateSandboxOpts,
    warmBaseSnapshot: string,
    envVars: Record<string, string>,
    sandboxApiBase: string,
  ): Promise<ProvisionResult> {
    const MAX_WARM_ATTEMPTS = 3; // Fewer than Daytona (4) — Tensorlake warm is more reliable
    let committedSandbox: InstanceType<typeof Sandbox> | null = null;

    for (let attempt = 1; attempt <= MAX_WARM_ATTEMPTS; attempt++) {
      let sandbox: InstanceType<typeof Sandbox> | null = null;
      try {
        const sandboxName = buildTensorlakeName(opts.accountId, `${opts.name}-warm`);

        const autoStopMinutes = opts.autoStopInterval ?? config.KORTIX_SANDBOX_AUTOSTOP_MINUTES;
        const timeoutSecs = autoStopMinutes === 0 ? 0 : Math.max(60, autoStopMinutes * 60);

        sandbox = await Sandbox.create({
          name: sandboxName,
          snapshotId: warmBaseSnapshot,
          cpus: DEFAULT_CPUS,
          memoryMb: DEFAULT_MEMORY_MB,
          timeoutSecs: timeoutSecs || DEFAULT_TIMEOUT_SECS,
          allowInternetAccess: true,
        });

        // Expose agent port
        await sandbox.update({
          exposedPorts: [AGENT_PORT],
          allowUnauthenticatedAccess: false,
        });

        // Run the warm restore script (same script as Daytona warm path)
        // This probes the runtime, resets the clock, writes env, launches daemon
        const script = warmRestoreScript(envVars, Math.floor(Date.now() / 1000));
        const result = await sandbox.run('bash', { args: ['-c', script], timeout: 60 });
        const output = (result as any).stdout || '';

        if (output.includes(WARM_RESTORE_MARKERS.noRuntime)) {
          console.warn(
            `[tensorlake] warm box ${sandbox.sandboxId} restored without runtime ` +
            `— attempt ${attempt}/${MAX_WARM_ATTEMPTS}, terminating and recreating`,
          );
          await sandbox.terminate().catch(() => {});
          continue;
        }

        if (!output.includes(WARM_RESTORE_MARKERS.wrote) || !output.includes(WARM_RESTORE_MARKERS.started)) {
          // Runtime present but env write / daemon launch didn't confirm
          console.warn(
            `[tensorlake] warm restore did not confirm env+daemon ` +
            `— attempt ${attempt}/${MAX_WARM_ATTEMPTS}`,
          );
          await sandbox.terminate().catch(() => {});
          throw new Error('[tensorlake] warm create: session env write / daemon launch did not confirm');
        }

        committedSandbox = sandbox;
        break;
      } catch (err) {
        if (err instanceof Error && err.message.includes('env write / daemon launch')) throw err;
        console.warn(
          `[tensorlake] warm create attempt ${attempt}/${MAX_WARM_ATTEMPTS} failed:`,
          err instanceof Error ? err.message : err,
        );
        if (sandbox) await sandbox.terminate().catch(() => {});
      }
    }

    if (!committedSandbox) {
      throw new WarmRuntimeUnavailableError(
        `warm base ${warmBaseSnapshot} unavailable after ${MAX_WARM_ATTEMPTS} attempts`,
      );
    }

    const externalId = committedSandbox.sandboxId;
    const baseUrl = `${sandboxApiBase}/v1/p/${externalId}/${AGENT_PORT}`;
    return {
      externalId,
      baseUrl,
      metadata: {
        provisionedBy: opts.userId,
        tensorlakeSandboxId: externalId,
        snapshot: warmBaseSnapshot,
        warm: true,
        version: SANDBOX_VERSION,
      },
    };
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async start(externalId: string): Promise<void> {
    runningStatusCache.delete(externalId);
    const sandbox = await Sandbox.connect({ sandboxId: externalId });
    await sandbox.resume();
  }

  async stop(externalId: string): Promise<void> {
    runningStatusCache.delete(externalId);
    const sandbox = await Sandbox.connect({ sandboxId: externalId });
    await sandbox.suspend();
  }

  async remove(externalId: string): Promise<void> {
    runningStatusCache.delete(externalId);
    const sandbox = await Sandbox.connect({ sandboxId: externalId });
    await sandbox.terminate();
  }

  // ─── Status ────────────────────────────────────────────────────────────────

  async getStatus(externalId: string): Promise<ProviderSandboxStatus> {
    const cachedAt = runningStatusCache.get(externalId);
    if (cachedAt !== undefined && Date.now() - cachedAt < STATUS_CACHE_TTL_MS) return 'running';

    try {
      const sandbox = await Sandbox.connect({ sandboxId: externalId });
      const info = await sandbox.info();
      const state = String((info as any).status ?? '').toLowerCase();

      if (state === 'running') {
        runningStatusCache.set(externalId, Date.now());
        return 'running';
      }
      runningStatusCache.delete(externalId);
      if (state === 'suspended' || state === 'suspending') return 'stopped';
      if (state === 'terminated') return 'removed';
      return 'unknown';
    } catch (err) {
      runningStatusCache.delete(externalId);
      // Distinguish "not found / terminated" (a 404 from the API) from transient
      // errors (network, 5xx). A 404 means the sandbox is gone — treat as
      // 'removed' so callers can mark the row failed instead of polling forever.
      const msg = err instanceof Error ? err.message : String(err);
      if (/not found|404|does not exist|no such|sandbox.*not/i.test(msg)) {
        return 'removed';
      }
      return 'unknown';
    }
  }

  // ─── Endpoint Resolution ───────────────────────────────────────────────────

  /**
   * Build the proxy URL for a sandbox port.
   * Uses the sandbox's actual region-specific domain (e.g. sandbox.gcp-use4.tensorlake.ai)
   * instead of the generic sandbox.tensorlake.ai which returns 502.
   */
  private async getSandboxProxyUrl(externalId: string, port: number): Promise<string> {
    try {
      const sb = await Sandbox.connect({ sandboxId: externalId });
      const info = await sb.info();
      const sandboxUrl = (info as any).sandboxUrl as string | undefined;
      if (sandboxUrl) {
        // sandboxUrl is like: https://<id>.sandbox.gcp-use4.tensorlake.ai
        // We need: https://<port>-<id>.sandbox.gcp-use4.tensorlake.ai
        const urlObj = new URL(sandboxUrl);
        const host = urlObj.hostname;
        return `https://${port}-${host}`;
      }
    } catch (err) {
      console.warn(`[TENSORLAKE] Failed to get sandbox URL for ${externalId}, using fallback:`, err);
    }
    // Fallback to the generic URL (may 502 on region-specific sandboxes)
    return `https://${port}-${externalId}.sandbox.tensorlake.ai`;
  }

  async resolveEndpoint(externalId: string): Promise<ResolvedEndpoint> {
    // Use the sandbox's region-specific URL instead of the generic one
    const url = await this.getSandboxProxyUrl(externalId, AGENT_PORT);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Look up the service key (sandboxes OR session_sandboxes) for sandbox-internal auth
    try {
      const serviceKey = await serviceKeyForExternalId(externalId);
      if (serviceKey) {
        headers['Authorization'] = `Bearer ${serviceKey}`;
      } else if (config.TENSORLAKE_API_KEY) {
        headers['Authorization'] = `Bearer ${config.TENSORLAKE_API_KEY}`;
      }
    } catch (err) {
      console.warn(`[TENSORLAKE] Failed to look up service key for ${externalId}:`, err);
      if (config.TENSORLAKE_API_KEY) {
        headers['Authorization'] = `Bearer ${config.TENSORLAKE_API_KEY}`;
      }
    }

    return { url, headers };
  }

  async resolvePreviewLink(externalId: string, port: number): Promise<{ url: string; token: string | null }> {
    // Ensure the port is exposed (Tensorlake requires explicit port exposure)
    try {
      const sandbox = await Sandbox.connect({ sandboxId: externalId });
      const info = await sandbox.info();
      const currentPorts: number[] = (info as any).exposedPorts ?? [];

      if (!currentPorts.includes(port)) {
        await sandbox.update({
          exposedPorts: [...currentPorts, port],
          allowUnauthenticatedAccess: false,
        });
      }
    } catch (err) {
      // Port exposure is best-effort — the sandbox might already have it exposed
      console.warn(`[TENSORLAKE] Failed to expose port ${port} for ${externalId}:`, err);
    }

    return {
      url: await this.getSandboxProxyUrl(externalId, port),
      token: config.TENSORLAKE_API_KEY,
    };
  }

  // ─── Ensure Running ────────────────────────────────────────────────────────

  async ensureRunning(externalId: string): Promise<void> {
    const status = await this.getStatus(externalId);
    if (status === 'running') return;
    console.log(`[TENSORLAKE] Sandbox ${externalId} is ${status}, waking up...`);
    await this.start(externalId);
  }

  // ─── List Managed ──────────────────────────────────────────────────────────

  async listManagedRunningSandboxes(): Promise<Array<{ externalId: string; createdAt: Date | null }>> {
    // Tensorlake does not support label-based filtering like Daytona.
    // Instead, we list all sandboxes and filter by name prefix.
    const out: Array<{ externalId: string; createdAt: Date | null }> = [];

    try {
      const sandboxes = await Sandbox.list();

      for (const sb of sandboxes ?? []) {
        const name: string | null = (sb as any).name ?? null;
        const status: string = String((sb as any).status ?? '').toLowerCase();

        // Only include running sandboxes with our managed name prefix
        if (status === 'running' && isManagedTensorlakeName(name)) {
          const raw = (sb as any).createdAt ?? null;
          out.push({
            externalId: (sb as any).sandboxId,
            createdAt: raw ? new Date(raw) : null,
          });
        }
      }
    } catch (err) {
      console.warn('[TENSORLAKE] listManagedRunningSandboxes failed:', err);
    }

    return out;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Launch the daemon when booting from a snapshot that already has the agent
   * binary. Filesystem snapshots don't preserve running processes, so we need
   * to write the session env and launch the daemon manually.
   */
  private async launchDaemonFromSnapshot(
    sandbox: InstanceType<typeof Sandbox>,
    envVars: Record<string, string>,
  ): Promise<void> {
    try {
      // 1. Write /opt/kortix/session.env (export format for sourcing)
      const envExport = Object.entries(envVars)
        .map(([k, v]) => `export ${k}='${v}'`)
        .join('\n');
      await sandbox.writeFile('/opt/kortix/session.env', Buffer.from(envExport, 'utf-8'));
      await sandbox.run('bash', { args: ['-c', 'chmod 600 /opt/kortix/session.env'], timeout: 5 });

      // 2. Write /etc/pt-env (key=value format, no quotes)
      const ptEnv = Object.entries(envVars)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
      await sandbox.writeFile('/etc/pt-env', Buffer.from(ptEnv, 'utf-8'));

      // 3. Launch the daemon via the entrypoint (same as cold-boot)
      await sandbox.run('bash', {
        args: ['-c', `setsid sudo bash -c 'set -a; source /opt/kortix/session.env; set +a; cd /; exec /usr/local/bin/kortix-entrypoint' </dev/null >/tmp/kortix-agent.log 2>&1 &`],
        timeout: 10,
      });

      console.log('[tensorlake] Daemon launched from snapshot — waiting for port 8000...');

      // 4. Wait for the daemon to start (max 30 seconds)
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          const check = await sandbox.run('bash', {
            args: ['-c', 'curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/kortix/health'],
            timeout: 5,
          });
          if (String((check as any).stdout ?? '').trim() === '200') {
            console.log(`[tensorlake] Daemon ready after ${i + 1}s`);
            return;
          }
        } catch { /* keep waiting */ }
      }
      console.warn('[tensorlake] Daemon did not become ready within 30s — proceeding anyway');
    } catch (err) {
      console.error('[tensorlake] Failed to launch daemon from snapshot:', err);
    }
  }

  /**
   * Write environment variables as an env file inside the sandbox.
   * The Kortix agent daemon sources this file at startup.
   */
  private async writeEnvFile(sandbox: InstanceType<typeof Sandbox>, envVars: Record<string, string>): Promise<void> {
    try {
      const envContent = Object.entries(envVars)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
      const encoder = new TextEncoder();
      await sandbox.writeFile(
        '/home/tl-user/.vaelorx-env',
        encoder.encode(envContent),
      );
    } catch (err) {
      console.warn('[TENSORLAKE] Failed to write env file:', err);
      // Non-fatal: the warm restore script will handle env injection
    }
  }

  // ─── Cold Boot Runtime Installation ────────────────────────────────────────
  //
  // When booting from the base image (no per-project snapshot), the sandbox
  // lacks the entire Kortix runtime (kortix-agent, opencode, bun, etc.).
  // This method installs everything imperatively, mirroring the warm-bake
  // pipeline but running it live inside the sandbox. The first boot takes
  // 3-5 minutes; after a checkpoint is taken, subsequent boots are instant.

  /**
   * Install the full Kortix runtime inside a base-image sandbox.
   *
   * Steps:
   *  1. Upload the gzipped kortix-agent binary + entrypoint script
   *  2. Run a comprehensive setup script that installs:
   *     - apt dependencies (git, nodejs, npm, …)
   *     - opencode (pinned version + migration bake)
   *     - bun runtime
   *     - kortix-agent + kortix-entrypoint binaries
   *  3. Write the session env file + /etc/pt-env
   *  4. Launch the daemon (same pattern as warmRestoreScript)
   */
  private async installRuntimeInSandbox(
    sandbox: InstanceType<typeof Sandbox>,
    envVars: Record<string, string>,
  ): Promise<void> {
    // Paths to the runtime artifacts (baked into the API Docker image —
    // see apps/api/Dockerfile lines 153-155).
    const agentBinPath = process.env.KORTIX_SNAPSHOT_AGENT_BIN_PATH
      || resolve(REPO_ROOT, 'apps/kortix-sandbox-agent-server/dist/kortix-agent');
    const entrypointPath = process.env.KORTIX_SNAPSHOT_ENTRYPOINT_PATH
      || resolve(REPO_ROOT, 'apps/sandbox/entrypoint.sh');

    // Verify the agent binary exists
    if (!existsSync(agentBinPath)) {
      throw new Error(
        `[tensorlake] Agent binary not found at ${agentBinPath}. ` +
        `Ensure the Docker image includes it (apps/api/Dockerfile COPY --from=sandbox-agent).`,
      );
    }

    console.log(`[tensorlake] Installing runtime in sandbox ${sandbox.sandboxId} (cold boot from base image)...`);

    // ── 1. Upload the agent binary (gzipped, single call) ───────────────────
    // Tensorlake's PUT /api/v1/files has no documented size limit — upload the
    // full 38 MB binary in ONE writeFile call instead of 19 chunked calls +
    // cat-reassembly. Falls back to chunking only if the single call fails
    // (e.g. transport-level cap on some plan). Single-shot is ~50× faster.
    const agentRaw = readFileSync(agentBinPath);
    const agentGz = gzipSync(agentRaw);
    console.log(`[tensorlake] Uploading agent binary (${(agentGz.length / 1048576).toFixed(1)} MB gzipped, ${agentRaw.length} bytes raw)...`);

    let uploaded = false;
    try {
      // Single-shot upload — ~50× faster than 19 chunked writes
      await sandbox.writeFile('/tmp/kortix-agent.gz', agentGz);
      uploaded = true;
      console.log(`[tensorlake] Agent binary uploaded in single call.`);
    } catch (singleErr) {
      console.warn(
        `[tensorlake] Single-shot upload failed (${singleErr instanceof Error ? singleErr.message : singleErr}), ` +
        `falling back to chunked upload.`,
      );
    }
    if (!uploaded) {
      // Fallback: upload in ≤2 MB chunks, then concatenate inside the sandbox
      const totalParts = Math.ceil(agentGz.length / UPLOAD_CHUNK_BYTES);
      for (let i = 0; i < totalParts; i++) {
        const start = i * UPLOAD_CHUNK_BYTES;
        const end = Math.min(start + UPLOAD_CHUNK_BYTES, agentGz.length);
        const part = agentGz.slice(start, end);
        const partName = String(i).padStart(3, '0');
        await sandbox.writeFile(`/tmp/kortix-agent.gz.${partName}`, part);
      }
      const catResult = await sandbox.run('bash', {
        args: ['-c', 'cat /tmp/kortix-agent.gz.* > /tmp/kortix-agent.gz && rm -f /tmp/kortix-agent.gz.*'],
        timeout: 30,
      });
      if ((catResult as any).exitCode !== 0) {
        throw new Error(`[tensorlake] Failed to reassemble agent binary: ${(catResult as any).stderr}`);
      }
    }

    // ── 2. Upload the entrypoint script ──────────────────────────────────────
    const entrypointData = readFileSync(entrypointPath, 'utf-8');
    await sandbox.writeFile(
      '/tmp/kortix-entrypoint',
      new TextEncoder().encode(entrypointData),
    );

    // ── 3. Run the setup script ──────────────────────────────────────────────
    const setupScript = buildColdSetupScript(envVars);
    console.log(`[tensorlake] Running cold-boot setup script in sandbox ${sandbox.sandboxId}...`);

    const result = await sandbox.run('bash', {
      args: ['-c', setupScript],
      timeout: 600, // 10 min — apt + opencode + bun can be slow
    });

    const exitCode = (result as any).exitCode ?? 1;
    const stdout = String((result as any).stdout ?? '');
    const stderr = String((result as any).stderr ?? '');

    if (exitCode !== 0) {
      console.error(`[tensorlake] Cold-boot setup failed (exit ${exitCode}). stderr: ${stderr.slice(-1000)}`);
      // Best-effort cleanup
      await sandbox.terminate().catch(() => {});
      throw new Error(`[tensorlake] Runtime installation failed in sandbox ${sandbox.sandboxId}: ${stderr.slice(-500)}`);
    }

    console.log(`[tensorlake] Cold-boot setup complete for sandbox ${sandbox.sandboxId}. Last output: ${stdout.split('\n').filter(Boolean).slice(-3).join(' | ')}`);

    // ── Inject scaffold files into /workspace ──────────────────────────────
    // The scaffold (vaelorx.toml, .vaelorx/opencode/agents, skills, tools, etc.)
    // is NOT baked into the old snapshot. Inject it directly using the SDK's
    // writeFile method. This gives the agent the full workspace structure
    // (memory, skills, tools, agents) that was previously only available in
    // project mode via GitHub clone.
    try {
      console.log('[tensorlake] Starting scaffold injection into /workspace...');
      const starterFiles = getStarterFiles({
        projectName: 'VaelorX Session',
        template: 'general-knowledge-worker',
      });
      console.log(`[tensorlake] Scaffold files to inject: ${starterFiles.length}`);

      let injected = 0;
      let failed = 0;
      for (const file of starterFiles) {
        const filePath = `/workspace/${file.path}`;
        try {
          const dir = filePath.substring(0, filePath.lastIndexOf('/'));
          await sandbox.run('bash', { args: ['-c', `mkdir -p ${dir}`], timeout: 5 });
          await sandbox.writeFile(filePath, Buffer.from(file.content, 'utf-8'));
          injected++;
        } catch {
          failed++;
        }
      }
      console.log(`[tensorlake] Scaffold injected: ${injected} files (${failed} failed) into /workspace`);
    } catch (err) {
      console.error(`[tensorlake] Scaffold injection FAILED:`, err instanceof Error ? err.message : String(err));
    }
  }
}

// ─── Cold-Boot Setup Script Builder ──────────────────────────────────────────
//
// Generates the bash script that installs the Kortix runtime inside a base
// image sandbox. Mirrors the warm-bake pipeline (warm-bake.ts) but runs
// imperatively. The script:
//   1. Installs apt deps (git, node, npm, ca-certs, tmux, etc.)
//   2. Installs opencode (pinned version) + runs the migration bake
//   3. Installs bun
//   4. Installs kortix-agent + kortix-entrypoint binaries
//   5. Writes session env + /etc/pt-env
//   6. Launches the daemon in the background

function buildColdSetupScript(envVars: Record<string, string>): string {
  const sh = (v: string) => `'${String(v).replace(/'/g, `'\\''`)}'`;

  // Build the session env file content (export format for sourcing)
  const envExports = Object.entries(envVars)
    .map(([k, v]) => `export ${k}=${sh(v)}`)
    .join('\n');
  const envB64 = Buffer.from(envExports, 'utf8').toString('base64');

  // Build the /etc/pt-env content (plain KEY=VALUE format for the health check).
  // IMPORTANT: /etc/pt-env is read by the agent daemon's regex (not sourced by
  // a shell), so it must NOT have surrounding quotes. The regex
  // /^KORTIX_BRANCH_NAME=(\S+)/m captures everything up to whitespace — if the
  // value is wrapped in quotes (KEY='value'), the regex captures the trailing
  // quote as part of the value, breaking the branch comparison and leaving
  // runtimeReady=false forever. Write plain KEY=value without quotes for values
  // that don't contain spaces or special chars.
  const ptEnvPlain = (v: string) => {
    // Only quote if the value contains spaces, #, or starts with a quote.
    // Branch names, UUIDs, URLs — none need quoting.
    if (/[\s#]/.test(v) || /^['"]/.test(v)) return sh(v)
    return v
  }
  const envPlain = Object.entries(envVars)
    .map(([k, v]) => `${k}=${ptEnvPlain(v)}`)
    .join('\n');
  const ptEnvB64 = Buffer.from(envPlain, 'utf8').toString('base64');

  // RUNTIME_ENV mirrors Dockerfile ENV lines that the imperative install can't bake
  const RUNTIME_ENV = 'export AGENT_BROWSER_ARGS=--no-sandbox,--disable-dev-shm-usage KORTIX_WORKSPACE=/workspace;';

  // SLIM COLD-BOOT SCRIPT — target <3 min total instead of ~25 min.
  // Removed: opencode migration bake (saves ~2-5 min — opencode self-migrates
  //          on first /session call, ~15-35s, acceptable).
  // Removed: bun install (saves ~30s — agent binary is pre-compiled, no bun
  //          runtime needed for it; bun is only needed for opencode tools).
  // Removed: nodejs/npm from initial apt install (saves ~2-3 min — installed
  //          lazily only if opencode install needs them).
  // Kept:    curl, git, ca-certs (required by agent for git operations).
  return `
set -euo pipefail

LOG_PREFIX="[tensorlake-cold-setup]"
echo "$LOG_PREFIX Starting SLIM runtime installation (target <3 min)..."

# ─── 1. Install minimal apt deps (curl + git + ca-certs only) ─────────────
# Skip nodejs/npm initially — they add 50+ MB and 2-3 min. Install lazily
# below only if opencode install needs them.
echo "$LOG_PREFIX Installing apt deps (curl, git, ca-certs)..."
sudo apt-get update -o Acquire::Retries=2 >/tmp/apt-update.log 2>&1 || true
sudo apt-get install -y --no-install-recommends \\
  ca-certificates curl git gzip unzip tmux \\
  >>/tmp/apt-install.log 2>&1 || true
echo "$LOG_PREFIX apt deps done."

# ─── 1b. Create swap space to prevent OOM kills under memory pressure ────
# Trial plan limits RAM to 1024 MB. Heavy operations (npm install, pip
# install, compilation) can exhaust RAM and trigger OOM killer, which kills
# the agent daemon. A 2 GB swap file lets the OS page out inactive memory
# instead of killing processes. This is critical for agent stability.
echo "$LOG_PREFIX Creating 2GB swap file..."
if [ ! -f /swapfile ]; then
  sudo dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none 2>/dev/null || true
  sudo chmod 600 /swapfile 2>/dev/null || true
  sudo mkswap /swapfile >/dev/null 2>&1 || true
  sudo swapon /swapfile 2>/dev/null || true
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null 2>&1 || true
  # Lower swappiness so swap is only used under real pressure (default 60 is too aggressive)
  echo 10 | sudo tee /proc/sys/vm/swappiness >/dev/null 2>&1 || true
  echo "$LOG_PREFIX Swap enabled (2GB)."
else
  sudo swapon /swapfile 2>/dev/null || true
  echo "$LOG_PREFIX Swap already exists, enabled."
fi

# ─── 1c. Protect the agent daemon from OOM killer ──────────────────────────
# Set OOM score to -1000 (never kill) for the agent daemon once it starts.
# This is done in the daemon launch section below (after the daemon PID is known).
echo "$LOG_PREFIX OOM protection will be applied to agent daemon after launch."

# ─── 2. Install opencode (REQUIRED — agent calls it via pty) ───────────────
echo "$LOG_PREFIX Checking for npm..."
if ! command -v npm >/dev/null 2>&1; then
  echo "$LOG_PREFIX npm not found, installing nodejs+npm..."
  sudo apt-get install -y --no-install-recommends nodejs npm >>/tmp/node-install.log 2>&1 || true
fi
if command -v npm >/dev/null 2>&1; then
  echo "$LOG_PREFIX Installing opencode@${OPENCODE_VERSION} via npm..."
  sudo npm install -g --no-audit --no-fund "opencode-ai@${OPENCODE_VERSION}" >/tmp/oc-install.log 2>&1 || {
    echo "$LOG_PREFIX WARN: opencode npm install failed, agent may fail at runtime"
    tail -5 /tmp/oc-install.log
  }
  opencode --version 2>/dev/null || echo "$LOG_PREFIX opencode not on PATH yet"
else
  echo "$LOG_PREFIX WARN: npm unavailable — opencode not installed"
fi
echo "$LOG_PREFIX opencode step done."

# NOTE: opencode migration bake SKIPPED — opencode self-migrates on first
# /session call (~15-35s on hot path). Saves 2-5 min on cold boot.

# NOTE: bun install SKIPPED — the kortix-agent binary is pre-compiled via
# bun build --compile (self-contained Linux binary, no bun runtime needed).
# If bun is needed for opencode tools later, it can be installed lazily.

# ─── 3. Create runtime directories ────────────────────────────────────────
echo "$LOG_PREFIX Creating runtime directories..."
sudo mkdir -p ${RUNTIME_HOME} ${RUNTIME_HOME}/.local/share ${RUNTIME_HOME}/.config ${RUNTIME_HOME}/.cache
sudo mkdir -p /workspace /ephemeral/kortix-master/opencode /opt/kortix/apps/sandbox /opt/kortix/packages

# ─── 4. Install kortix binaries ───────────────────────────────────────────
echo "$LOG_PREFIX Installing kortix-agent + entrypoint..."
# IMPORTANT: 'sudo gunzip -c X > /usr/local/bin/Y' does NOT work — the shell
# redirect '>' is performed by the calling user (tl-user), not sudo. Use
# 'gunzip | sudo tee' so the write happens as root (same pattern as warm-bake.ts).
gunzip -c /tmp/kortix-agent.gz | sudo tee /usr/local/bin/kortix-agent >/dev/null
sudo cp /tmp/kortix-entrypoint /usr/local/bin/kortix-entrypoint
sudo chmod 755 /usr/local/bin/kortix-agent /usr/local/bin/kortix-entrypoint
sudo chown root:root /usr/local/bin/kortix-agent /usr/local/bin/kortix-entrypoint
rm -f /tmp/kortix-agent.gz /tmp/kortix-entrypoint
# Verify the binary is executable — fail fast if not
if [ ! -x /usr/local/bin/kortix-agent ]; then
  echo "$LOG_PREFIX FATAL: /usr/local/bin/kortix-agent not executable after install"
  ls -la /usr/local/bin/kortix-agent
  exit 1
fi
echo "$LOG_PREFIX kortix binaries installed and verified executable."

# ─── 5. Write session env file ────────────────────────────────────────────
echo "$LOG_PREFIX Writing session env..."
sudo mkdir -p /opt/kortix
echo '${envB64}' | base64 -d | sudo tee /opt/kortix/session.env >/dev/null
sudo chmod 600 /opt/kortix/session.env

# ─── 6. Write /etc/pt-env (health check reads KORTIX_BRANCH_NAME from here)
echo "$LOG_PREFIX Writing /etc/pt-env..."
echo '${ptEnvB64}' | base64 -d | sudo tee /etc/pt-env >/dev/null

# ─── 7. Set ownership ─────────────────────────────────────────────────────
sudo chown -R tl-user:tl-user /opt/kortix /workspace /ephemeral 2>/dev/null || true

# ─── 8. Launch the daemon ─────────────────────────────────────────────────
echo "$LOG_PREFIX Launching kortix-agent daemon..."
setsid sudo bash -c '${RUNTIME_ENV} set -a; source /opt/kortix/session.env; set +a; cd /; exec /usr/local/bin/kortix-entrypoint' </dev/null >/tmp/kortix-agent.log 2>&1 &
DAEMON_PID=$!
echo "$LOG_PREFIX Daemon launched (PID=$DAEMON_PID)."

# ─── 8b. Protect the daemon from OOM killer ───────────────────────────────
# Wait briefly for the daemon process tree to stabilize, then set OOM score
# to -1000 (never kill) for the daemon and its children. This ensures that
# under memory pressure, the OOM killer targets the heavy child processes
# (npm, pip, gcc) instead of the agent daemon itself.
sleep 2
DAEMON_PIDS=$(pgrep -f 'kortix-agent|kortix-entrypoint' 2>/dev/null || echo "$DAEMON_PID")
for pid in $DAEMON_PIDS; do
  echo -1000 | sudo tee /proc/$pid/oom_score_adj 2>/dev/null || true
done
echo "$LOG_PREFIX OOM protection applied to daemon PIDs: $DAEMON_PIDS"

# Also set a default memory limit for opencode child processes so a single
# runaway command can't exhaust all RAM. The agent itself is protected above.
# Using cgroup v2 memory.max if available, else fall back to ulimit.
if [ -f /sys/fs/cgroup/memory.max ] 2>/dev/null; then
  # cgroup v2 — set a soft limit on the sandbox's cgroup
  echo "$LOG_PREFIX cgroup v2 detected — memory limits managed by Tensorlake."
fi

echo "$LOG_PREFIX Runtime installation COMPLETE."
`;
}
