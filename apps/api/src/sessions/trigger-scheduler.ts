/**
 * Session Triggers Cron Scheduler — runs on the leader-elected API replica.
 *
 * Every 60 seconds, scans all active sessions with triggers stored in their
 * sandboxes. For each trigger whose `next_run_at` has passed, calls the
 * daemon's `/kortix/triggers/:id/run` endpoint to execute the trigger.
 *
 * The triggers themselves live in the sandbox filesystem
 * (/workspace/.vaelorx/triggers.json) — the scheduler just reads the list
 * via the daemon's GET /kortix/triggers and fires due ones.
 *
 * This is intentionally lightweight: the scheduler does NOT parse cron
 * expressions itself. Instead, it asks the daemon for all triggers, and
 * the daemon computes next_run_at when triggers are created/updated.
 * (If the daemon doesn't set next_run_at, the scheduler skips the trigger.)
 */

import { db } from '../shared/db';
import { sessionSandboxes } from '@kortix/db';
import { eq, and, sql } from 'drizzle-orm';
import { logger } from '../lib/logger';

const TICK_INTERVAL_MS = 60_000; // 1 minute
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startTriggerScheduler(): void {
  if (timer) return;
  logger.info('[trigger-scheduler] starting — tick every 60s');
  timer = setInterval(() => {
    void tick().catch((err) => {
      logger.error('[trigger-scheduler] tick failed', { error: err instanceof Error ? err.message : String(err) });
    });
  }, TICK_INTERVAL_MS);
  // Run once immediately on startup
  void tick().catch(() => {});
}

export function stopTriggerScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info('[trigger-scheduler] stopped');
  }
}

async function tick(): Promise<void> {
  if (running) return; // skip if previous tick is still running
  running = true;
  try {
    // Find all active sandboxes (sessions with running sandboxes)
    const sandboxes = await db
      .select({
        sessionId: sessionSandboxes.sessionId,
        externalId: sessionSandboxes.externalId,
      })
      .from(sessionSandboxes)
      .where(
        and(
          eq(sessionSandboxes.status, 'active'),
          sql`${sessionSandboxes.externalId} IS NOT NULL`,
        ),
      )
      .limit(50); // process at most 50 per tick to avoid overload

    if (sandboxes.length === 0) return;

    // For each active sandbox, fetch triggers and fire due ones
    const results = await Promise.allSettled(
      sandboxes.map((sb) => processSandboxTriggers(sb.sessionId, sb.externalId!)),
    );

    const fired = results.filter((r) => r.status === 'fulfilled' && r.value > 0).length;
    if (fired > 0) {
      logger.info(`[trigger-scheduler] tick complete — fired triggers in ${fired} sandbox(es)`);
    }
  } finally {
    running = false;
  }
}

async function processSandboxTriggers(
  sessionId: string,
  externalId: string,
): Promise<number> {
  try {
    // Resolve the sandbox's preview URL + service key
    const { resolvePreviewLink, resolveServiceKey } = await import('../sandbox-proxy/backend');
    const preview = await resolvePreviewLink(externalId, 8000); // daemon runs on port 8000
    const serviceKey = await resolveServiceKey(externalId);
    if (!preview?.url || !serviceKey) return 0;

    // Fetch triggers from the daemon
    const response = await fetch(`${preview.url}/kortix/triggers`, {
      headers: {
        'X-Kortix-User-Context': serviceKey,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return 0;

    const data = await response.json();
    const triggers = (data?.data ?? []) as Array<{
      id: string;
      enabled: boolean;
      next_run_at?: string;
      name: string;
    }>;

    let firedCount = 0;
    const now = new Date();

    for (const trigger of triggers) {
      if (!trigger.enabled) continue;
      if (!trigger.next_run_at) continue;

      const nextRun = new Date(trigger.next_run_at);
      if (nextRun > now) continue; // not due yet

      // Fire the trigger
      logger.info(`[trigger-scheduler] firing trigger "${trigger.name}" (${trigger.id}) for session ${sessionId}`);

      try {
        const runResponse = await fetch(
          `${preview.url}/kortix/triggers/${trigger.id}/run`,
          {
            method: 'POST',
            headers: {
              'X-Kortix-User-Context': serviceKey,
              'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (runResponse.ok) {
          firedCount++;
        } else {
          logger.warn(`[trigger-scheduler] trigger ${trigger.id} run failed: HTTP ${runResponse.status}`);
        }
      } catch (err) {
        logger.warn(`[trigger-scheduler] trigger ${trigger.id} run error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return firedCount;
  } catch (err) {
    // Silently skip — sandbox may be temporarily unreachable
    return 0;
  }
}
