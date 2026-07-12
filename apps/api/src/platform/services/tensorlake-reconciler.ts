/**
 * Tensorlake billing reconciler — polling-based alternative to Daytona webhooks.
 *
 * Problem: Tensorlake does not emit lifecycle webhooks (unlike Daytona's Svix
 * system). Without webhooks, billing reconciliation cannot happen instantly
 * when a sandbox suspends/terminates.
 *
 * Solution: Periodic polling that checks all active Tensorlake sandboxes and
 * reconciles their billing state. The reaper (sandbox-reaper.ts) remains the
 * deterministic backstop — this reconciler provides faster billing closure
 * (within RECONCILE_INTERVAL_MS instead of the reaper's sweep cadence).
 *
 * Architecture:
 *   1. Every RECONCILE_INTERVAL_MS, list all DB-tracked Tensorlake sandboxes
 *      with status = 'active' (meaning we're billing for them).
 *   2. For each, check the actual Tensorlake status via the SDK.
 *   3. If suspended → reconcileSandboxStoppedByExternalId (stop billing).
 *   4. If terminated → reconcileSandboxRemovedByExternalId (close billing).
 *   5. Update our known-state map for next cycle.
 */

import { config } from '../../config';
import { Sandbox, isManagedTensorlakeName } from '../../shared/tensorlake';

// ─── Configuration ─────────────────────────────────────────────────────────────

const RECONCILE_INTERVAL_MS = 30_000; // 30 seconds
const MAX_CONCURRENT_CHECKS = 10; // Don't hammer the API

// ─── Types ─────────────────────────────────────────────────────────────────────

type SandboxState = 'running' | 'suspended' | 'terminated' | 'pending' | 'unknown';

interface ReconcileResult {
  externalId: string;
  previousState: SandboxState;
  currentState: SandboxState;
  action: 'none' | 'stopped' | 'removed';
}

// ─── State ─────────────────────────────────────────────────────────────────────

const knownStates = new Map<string, SandboxState>();
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

// ─── Billing Reconciliation (imported dynamically to avoid circular deps) ──────

async function reconcileSandboxStopped(externalId: string): Promise<void> {
  try {
    const { reconcileSandboxStoppedByExternalId } = await import('../../projects/sandbox-reaper');
    await reconcileSandboxStoppedByExternalId(externalId);
  } catch {
    // Module might not exist or function might fail — the reaper is the backstop
    console.warn(`[tensorlake-reconciler] Failed to reconcile billing stop for ${externalId}`);
  }
}

async function reconcileSandboxRemoved(externalId: string): Promise<void> {
  try {
    const { reconcileSandboxRemovedByExternalId } = await import('../../projects/sandbox-reaper');
    await reconcileSandboxRemovedByExternalId(externalId);
  } catch {
    console.warn(`[tensorlake-reconciler] Failed to reconcile billing removal for ${externalId}`);
  }
}

// ─── DB Query (imported dynamically) ──────────────────────────────────────────

async function getActiveTensorlakeSandboxes(): Promise<Array<{
  externalId: string;
  sandboxId: string;
}>> {
  try {
    const { db } = await import('../../shared/db');
    const { sessionSandboxes } = await import('@kortix/db');
    const { eq, and } = await import('drizzle-orm');
    const rows = await db
      .select({
        externalId: sessionSandboxes.externalId,
        sandboxId: sessionSandboxes.sandboxId,
      })
      .from(sessionSandboxes)
      .where(
        and(
          eq(sessionSandboxes.provider, 'tensorlake'),
          eq(sessionSandboxes.status, 'active'),
        ),
      );
    return rows.map((r: any) => ({
      externalId: r.externalId,
      sandboxId: r.sandboxId,
    }));
  } catch {
    return [];
  }
}

// ─── Daemon Health Check (watchdog) ───────────────────────────────────────────
// The kortix-agent daemon inside each sandbox can crash due to a memory leak
// (MaxListenersExceededWarning). This watchdog checks every active sandbox's
// daemon health and restarts it if it's down.

async function checkAndRestartDaemon(externalId: string): Promise<boolean> {
  try {
    const sandbox = await Sandbox.connect({ sandboxId: externalId });
    
    // Check if daemon is responding on port 8000
    const healthResult = await sandbox.run('bash', {
      args: ['-c', 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/kortix/health 2>/dev/null || echo 000'],
      timeout: 10,
    });
    const healthCode = String((healthResult as any).stdout ?? '').trim();
    
    if (healthCode === '200') {
      return false; // Daemon is healthy
    }
    
    // Daemon is down — restart it
    console.warn(`[daemon-watchdog] Daemon down (health=${healthCode}) for ${externalId} — restarting...`);
    
    // Launch the daemon via the entrypoint
    await sandbox.run('bash', {
      args: ['-c', `setsid bash -c 'set -a; source /opt/kortix/session.env; set +a; cd /; exec /usr/local/bin/kortix-entrypoint' </dev/null >/tmp/kortix-agent.log 2>&1 & disown; echo STARTED`],
      timeout: 10,
    });
    
    // Wait for boot
    await new Promise((r) => setTimeout(r, 15000));
    
    // Verify it's back
    const recheck = await sandbox.run('bash', {
      args: ['-c', 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/kortix/health 2>/dev/null || echo 000'],
      timeout: 10,
    });
    const recheckCode = String((recheck as any).stdout ?? '').trim();
    
    if (recheckCode === '200') {
      console.log(`[daemon-watchdog] Daemon restarted successfully for ${externalId}`);
      return true;
    } else {
      console.warn(`[daemon-watchdog] Daemon restart failed for ${externalId} (health=${recheckCode})`);
      return false;
    }
  } catch (err) {
    console.warn(`[daemon-watchdog] Error checking ${externalId}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

// ─── Core Reconciliation ───────────────────────────────────────────────────────

async function checkSandboxStatus(externalId: string): Promise<SandboxState> {
  try {
    const sandbox = await Sandbox.connect({ sandboxId: externalId });
    const info = await sandbox.info();
    const state = String((info as any).status ?? '').toLowerCase();

    if (state === 'running') return 'running';
    if (state === 'suspended' || state === 'suspending') return 'suspended';
    if (state === 'terminated') return 'terminated';
    if (state === 'pending') return 'pending';
    return 'unknown';
  } catch {
    // Sandbox not found or API error → assume terminated
    return 'terminated';
  }
}

async function reconcileOnce(): Promise<ReconcileResult[]> {
  if (!config.TENSORLAKE_API_KEY) return [];

  const results: ReconcileResult[] = [];
  const activeSandboxes = await getActiveTensorlakeSandboxes();

  // Process in batches to avoid API rate limits
  for (let i = 0; i < activeSandboxes.length; i += MAX_CONCURRENT_CHECKS) {
    const batch = activeSandboxes.slice(i, i + MAX_CONCURRENT_CHECKS);
    const checks = await Promise.allSettled(
      batch.map(async (sb) => {
        const currentState = await checkSandboxStatus(sb.externalId);
        const previousState = knownStates.get(sb.externalId) ?? 'running';

        let action: ReconcileResult['action'] = 'none';
        if (currentState === 'suspended' && previousState === 'running') {
          await reconcileSandboxStopped(sb.externalId);
          action = 'stopped';
        } else if (currentState === 'terminated') {
          await reconcileSandboxRemoved(sb.externalId);
          action = 'removed';
        } else if (currentState === 'running') {
          // Daemon health check — restart if down
          await checkAndRestartDaemon(sb.externalId);
        }

        knownStates.set(sb.externalId, currentState);
        return {
          externalId: sb.externalId,
          previousState,
          currentState,
          action,
        };
      }),
    );

    for (const check of checks) {
      if (check.status === 'fulfilled') results.push(check.value);
    }
  }

  // Also check all Tensorlake sandboxes via list (for orphans not in DB)
  try {
    const allSandboxes = await Sandbox.list();
    for (const sb of allSandboxes ?? []) {
      if (!isManagedTensorlakeName((sb as any).name)) continue;
      if (String((sb as any).status).toLowerCase() === 'terminated' && knownStates.has((sb as any).sandboxId)) {
        await reconcileSandboxRemoved((sb as any).sandboxId);
        knownStates.delete((sb as any).sandboxId);
      }
    }
  } catch {
    // Best-effort orphan check
  }

  return results;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Start the polling reconciler. Idempotent — safe to call multiple times.
 * Only runs when TENSORLAKE_API_KEY is configured.
 */
export function startTensorlakeReconciler(): void {
  if (intervalHandle) return; // Already running
  if (!config.TENSORLAKE_API_KEY) return; // Not configured

  console.log('[tensorlake-reconciler] Starting polling reconciler (interval: 30s)');

  // Initial reconcile
  void reconcileOnce().then((results) => {
    const stopped = results.filter((r) => r.action === 'stopped').length;
    const removed = results.filter((r) => r.action === 'removed').length;
    if (stopped || removed) {
      console.log(`[tensorlake-reconciler] Initial pass: ${stopped} stopped, ${removed} removed`);
    }
  });

  intervalHandle = setInterval(async () => {
    if (isRunning) return; // Previous cycle still in progress
    isRunning = true;
    try {
      const results = await reconcileOnce();
      const stopped = results.filter((r) => r.action === 'stopped').length;
      const removed = results.filter((r) => r.action === 'removed').length;
      if (stopped || removed) {
        console.log(`[tensorlake-reconciler] Reconciled: ${stopped} stopped, ${removed} removed`);
      }
    } catch (err) {
      console.warn('[tensorlake-reconciler] Reconciliation error:', err);
    } finally {
      isRunning = false;
    }
  }, RECONCILE_INTERVAL_MS);
}

/**
 * Stop the polling reconciler. Call on graceful shutdown.
 */
export function stopTensorlakeReconciler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[tensorlake-reconciler] Stopped');
  }
}

/**
 * Force an immediate reconciliation cycle (for testing or manual trigger).
 */
export async function forceReconcile(): Promise<ReconcileResult[]> {
  return reconcileOnce();
}
