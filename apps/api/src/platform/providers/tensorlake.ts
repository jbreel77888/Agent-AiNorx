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
 */

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

// ─── Status Cache ──────────────────────────────────────────────────────────────
// Same pattern as DaytonaProvider: short-TTL cache on the hot path to avoid
// redundant round-trips when the UI polls every ~800ms.

const STATUS_CACHE_TTL_MS = 1500;
const runningStatusCache = new Map<string, number>(); // externalId → cachedAt (ms)

// ─── Default Resources ────────────────────────────────────────────────────────

const DEFAULT_CPUS = 1.0;
const DEFAULT_MEMORY_MB = 1024;
const DEFAULT_TIMEOUT_SECS = 600; // 10 minutes idle → auto-suspend

// ─── Agent Port ───────────────────────────────────────────────────────────────
// The Kortix agent daemon listens on port 8000 inside the sandbox.

const AGENT_PORT = 8000;

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
   * Like Daytona, every sandbox boots from its project's own snapshot (built
   * by apps/api/src/snapshots/builder.ts). There is no shared fallback.
   */
  private async createCold(
    opts: CreateSandboxOpts,
    envVars: Record<string, string>,
    sandboxApiBase: string,
  ): Promise<ProvisionResult> {
    // Every sandbox must boot from a per-project snapshot — same contract as
    // Daytona. A missing snapshot means the project's first build hasn't
    // finished, which is a session-creation error.
    const snapshot = opts.snapshot;
    if (!snapshot) {
      throw new Error(
        'Tensorlake create() called without opts.snapshot. ' +
        'Every sandbox must boot from a per-project snapshot built by ' +
        'apps/api/src/snapshots/builder.ts. There is no shared fallback.',
      );
    }

    const sandboxName = buildTensorlakeName(opts.accountId, opts.name);
    const autoStopMinutes = opts.autoStopInterval ?? config.KORTIX_SANDBOX_AUTOSTOP_MINUTES;
    const timeoutSecs = autoStopMinutes === 0 ? 0 : Math.max(60, autoStopMinutes * 60);

    const sandbox = await Sandbox.create({
      name: sandboxName,
      snapshotId: snapshot,
      cpus: DEFAULT_CPUS,
      memoryMb: DEFAULT_MEMORY_MB,
      timeoutSecs: timeoutSecs || DEFAULT_TIMEOUT_SECS,
      allowInternetAccess: true,
    });

    // Expose the agent daemon port so the proxy can reach it
    await sandbox.update({
      exposedPorts: [AGENT_PORT],
      allowUnauthenticatedAccess: false,
    });

    // Write env vars as an env file inside the sandbox
    await this.writeEnvFile(sandbox, envVars);

    const externalId = sandbox.sandboxId;
    const baseUrl = `${sandboxApiBase}/v1/p/${externalId}/${AGENT_PORT}`;

    return {
      externalId,
      baseUrl,
      metadata: {
        provisionedBy: opts.userId,
        tensorlakeSandboxId: externalId,
        snapshot,
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
}
