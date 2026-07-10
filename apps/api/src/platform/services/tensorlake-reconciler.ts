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
