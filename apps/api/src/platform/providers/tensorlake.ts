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
const DEFAULT_TIMEOUT_SECS = 600; // 10 minutes idle → auto-suspend

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

    const sandboxName = buildTensorlakeName(opts.accountId, opts.name);
    const autoStopMinutes = opts.autoStopInterval ?? config.KORTIX_SANDBOX_AUTOSTOP_MINUTES;
    const timeoutSecs = autoStopMinutes === 0 ? 0 : Math.max(60, autoStopMinutes * 60);

    // Create sandbox from snapshot (if built) or base image (fallback)
    const createOpts: Record<string, unknown> = {
      name: sandboxName,
      cpus: DEFAULT_CPUS,
      memoryMb: DEFAULT_MEMORY_MB,
      timeoutSecs: timeoutSecs || DEFAULT_TIMEOUT_SECS,
      allowInternetAccess: true,
    };

    // snapshotId takes priority (pre-built image), otherwise use base image
    if (snapshot) {
      createOpts.snapshotId = snapshot;
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
    if (!snapshot) {
      await this.installRuntimeInSandbox(sandbox, envVars);
    }

    const externalId = sandbox.sandboxId;
    const baseUrl = `${sandboxApiBase}/v1/p/${externalId}/${AGENT_PORT}`;

    return {
      externalId,
      baseUrl,
      metadata: {
        provisionedBy: opts.userId,
        tensorlakeSandboxId: externalId,
        snapshot: snapshot || null,
        image: snapshot ? undefined : baseImage,
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
    } catch {
      runningStatusCache.delete(externalId);
      return 'unknown';
    }
  }

  // ─── Endpoint Resolution ───────────────────────────────────────────────────

  async resolveEndpoint(externalId: string): Promise<ResolvedEndpoint> {
    // Tensorlake URLs are deterministic: https://{port}-{id}.sandbox.tensorlake.ai
    // No preview link resolution or signed URLs needed (unlike Daytona).
    const url = `https://${AGENT_PORT}-${externalId}.sandbox.tensorlake.ai`;

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
      url: `https://${port}-${externalId}.sandbox.tensorlake.ai`,
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

    // ── 1. Upload the agent binary (gzipped → chunked) ──────────────────────
    const agentRaw = readFileSync(agentBinPath);
    const agentGz = gzipSync(agentRaw);
    console.log(`[tensorlake] Uploading agent binary (${(agentGz.length / 1048576).toFixed(1)} MB gzipped, ${agentRaw.length} bytes raw)...`);

    if (agentGz.length <= UPLOAD_CHUNK_BYTES) {
      await sandbox.writeFile('/tmp/kortix-agent.gz', agentGz);
    } else {
      // Upload in ≤2 MB chunks, then concatenate inside the sandbox
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

  // Build the /etc/pt-env content (plain KEY=VALUE format for the health check)
  const envPlain = Object.entries(envVars)
    .map(([k, v]) => `${k}=${sh(v)}`)
    .join('\n');
  const ptEnvB64 = Buffer.from(envPlain, 'utf8').toString('base64');

  // RUNTIME_ENV mirrors Dockerfile ENV lines that the imperative install can't bake
  const RUNTIME_ENV = 'export AGENT_BROWSER_ARGS=--no-sandbox,--disable-dev-shm-usage KORTIX_WORKSPACE=/workspace;';

  return `
set -euo pipefail

LOG_PREFIX="[tensorlake-cold-setup]"
echo "$LOG_PREFIX Starting runtime installation..."

# ─── 1. Install apt dependencies ──────────────────────────────────────────
echo "$LOG_PREFIX Installing apt dependencies..."
sudo apt-get update -o Acquire::Retries=2 >/tmp/apt-update.log 2>&1 || true
sudo apt-get install -y --no-install-recommends \\
  ca-certificates curl git gzip nodejs npm unzip tmux iproute2 \\
  >>/tmp/apt-install.log 2>&1 || {
  echo "$LOG_PREFIX apt install failed, trying with fallback..."
  cat /tmp/apt-install.log | tail -5
  # Retry once more
  sudo apt-get update -o Acquire::Retries=3 >/dev/null 2>&1 || true
  sudo apt-get install -y --no-install-recommends \\
    ca-certificates curl git gzip nodejs npm unzip tmux \\
    >/tmp/apt-install2.log 2>&1
}
echo "$LOG_PREFIX apt deps done. node: $(node -v 2>/dev/null || echo 'N/A'), npm: $(npm -v 2>/dev/null || echo 'N/A')"

# ─── 2. Create runtime directories ────────────────────────────────────────
echo "$LOG_PREFIX Creating runtime directories..."
sudo mkdir -p ${RUNTIME_HOME} ${RUNTIME_HOME}/.local/share ${RUNTIME_HOME}/.config ${RUNTIME_HOME}/.cache
sudo mkdir -p ${RUNTIME_HOME}/.bun/install/cache ${RUNTIME_HOME}/.agent-browser/browsers
sudo mkdir -p /workspace /ephemeral/kortix-master/opencode /opt/kortix/apps/sandbox /opt/kortix/packages

# ─── 3. Install opencode ──────────────────────────────────────────────────
echo "$LOG_PREFIX Installing opencode@${OPENCODE_VERSION}..."
sudo npm install -g --no-audit --no-fund "opencode-ai@${OPENCODE_VERSION}" >/tmp/oc-install.log 2>&1
opencode --version
echo "$LOG_PREFIX opencode installed."

# ─── 4. Run opencode migration bake ───────────────────────────────────────
echo "$LOG_PREFIX Running opencode migration bake..."
export HOME=${RUNTIME_HOME}
export XDG_DATA_HOME=${RUNTIME_HOME}/.local/share
export XDG_CONFIG_HOME=${RUNTIME_HOME}/.config
export XDG_CACHE_HOME=${RUNTIME_HOME}/.cache
opencode serve --port 4096 --hostname 127.0.0.1 >/tmp/oc-bake.log 2>&1 &
oc_pid=$!
for i in $(seq 1 120); do
  curl -s -o /dev/null -m 2 http://127.0.0.1:4096/ && break
  kill -0 "$oc_pid" 2>/dev/null || break
  sleep 1
done
sleep 2
kill "$oc_pid" 2>/dev/null || true
wait "$oc_pid" 2>/dev/null || true
echo "$LOG_PREFIX opencode migration bake done."

# ─── 5. Install bun ───────────────────────────────────────────────────────
echo "$LOG_PREFIX Installing bun..."
if ! command -v bun >/dev/null; then
  curl -fsSL https://bun.com/install | bash >/tmp/bun-install.log 2>&1 || true
  sudo install -m 755 ${RUNTIME_HOME}/.bun/bin/bun /usr/local/bin/bun 2>/dev/null || \
    sudo install -m 755 "$HOME/.bun/bin/bun" /usr/local/bin/bun 2>/dev/null || true
fi
echo "$LOG_PREFIX bun: $(bun --version 2>/dev/null || echo 'not installed')"

# ─── 6. Install kortix binaries ───────────────────────────────────────────
echo "$LOG_PREFIX Installing kortix-agent + entrypoint..."
sudo gunzip -c /tmp/kortix-agent.gz > /usr/local/bin/kortix-agent
sudo cp /tmp/kortix-entrypoint /usr/local/bin/kortix-entrypoint
sudo chmod +x /usr/local/bin/kortix-agent /usr/local/bin/kortix-entrypoint
rm -f /tmp/kortix-agent.gz /tmp/kortix-entrypoint
echo "$LOG_PREFIX kortix binaries installed."

# ─── 7. Write session env file ────────────────────────────────────────────
echo "$LOG_PREFIX Writing session env..."
sudo mkdir -p /opt/kortix
echo '${envB64}' | base64 -d | sudo tee /opt/kortix/session.env >/dev/null
sudo chmod 600 /opt/kortix/session.env

# ─── 8. Write /etc/pt-env (health check reads KORTIX_BRANCH_NAME from here)
echo "$LOG_PREFIX Writing /etc/pt-env..."
echo '${ptEnvB64}' | base64 -d | sudo tee /etc/pt-env >/dev/null

# ─── 9. Set ownership ─────────────────────────────────────────────────────
sudo chown -R tl-user:tl-user /opt/kortix /workspace /ephemeral 2>/dev/null || true

# ─── 10. Launch the daemon ────────────────────────────────────────────────
echo "$LOG_PREFIX Launching kortix-agent daemon..."
setsid sudo bash -c '${RUNTIME_ENV} set -a; source /opt/kortix/session.env; set +a; cd /; exec /usr/local/bin/kortix-entrypoint' </dev/null >/tmp/kortix-agent.log 2>&1 &
echo "$LOG_PREFIX Daemon launched (PID=$!)."

echo "$LOG_PREFIX Runtime installation complete."
`;
}
