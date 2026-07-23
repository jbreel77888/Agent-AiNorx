/**
 * Account-scoped warm pool (session-only mode).
 *
 * This is a parallel subsystem to the project-scoped warm-pool.ts. In
 * session-only mode there are no projects — sessions are created directly
 * under an account. This file pre-boots session-less spare sandboxes per
 * account so that when a user opens a new session, the allocator can claim
 * a ready spare in ~1-2 seconds instead of cold-provisioning (~20-40s).
 *
 * Dormant by default: every entry point is gated on
 * `accountWarmPoolSetting().enabled`. When the operator hasn't flipped the
 * flag on, every function here returns null/no-op and the cold path is
 * taken unchanged. This lets us ship the code now and activate later
 * without a redeploy.
 *
 * Design (mirrors the project-scoped warm-pool.ts, minus the git/repo
 * machinery — in session-only mode there's no repo, no manifest, no
 * per-template opt-in. One default sandbox template per account.):
 *
 *   - spawnSpareForAccount: provision a session-less box with env
 *     KORTIX_WARM_POOL=1 so the daemon boots runPoolMode (opencode + proxy
 *     up, parked). The row's sandbox_id is a throwaway SPARE uuid (NOT a
 *     session id).
 *   - claimSpareForAccountSession: atomically grabs a parked spare,
 *     stages the session env into the box via the daemon's /file/upload,
 *     and BINDS a fresh session_sandboxes row keyed sandbox_id == session_id
 *     at the spare's external_id.
 *   - any miss/error ⇒ return null ⇒ allocator cold-falls-back unchanged.
 *   - reconcile: leader-only periodic sweep. Reads
 *     account_warm_pool_presence for accounts with fresh heartbeats,
 *     reaps stale spares, refills present accounts toward their target size.
 */
import { and, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import {
  accountWarmPoolPresence,
  kortixApiKeys,
  sessionSandboxes,
} from '@kortix/db';
import { config } from '../../config';
import { db } from '../../shared/db';
import { getProvider } from '../providers';
import { selectProvider } from './provider-balancer';
import { createApiKey } from '../../repositories/api-keys';
import { createAccountToken } from '../../repositories/account-tokens';
import { accountEntitledToLlmGateway } from '../../shared/account-limits';
import { checkBillingActive } from '../../billing/services/billing-gate';
import { ensureSandboxImage, DEFAULT_SANDBOX_SLUG } from '../../snapshots/builder';
import type { GitBackedProject } from '../../projects/git';
import {
  accountWarmPoolSetting,
  type AccountWarmPoolSetting,
} from './runtime-settings';

/** Throwaway project shell for ensureSandboxImage — in session-only mode there
 *  is no project/repo, we always boot the platform default template. Mirrors
 *  the PLATFORM_PROJECT_SHELL pattern in snapshots/builder.ts. */
const ACCOUNT_POOL_PROJECT_SHELL: GitBackedProject = {
  projectId: '',
  repoUrl: '',
  defaultBranch: '',
  manifestPath: '',
  gitAuthToken: null,
};

const POOL_BOOT_TIMEOUT_MS = 8 * 60 * 1000; // booting/parked longer than this → reap
const POOL_MAX_AGE_MS = 6 * 60 * 60 * 1000; // parked longer than this → cycle (snapshot drift)
const CLAIM_STALE_MS = 5 * 60 * 1000; // a 'claiming' row older than this → the claimant died → reap
const READY_PROBE_INTERVAL_MS = 2000;
const PRESENCE_TTL_MS = 3 * 60 * 1000; // presence row older than this → no recent sessions → reap presence
const MAX_WARM_SIZE = 25;
const DAEMON_PORT = 8000;

// ─── Master gate ────────────────────────────────────────────────────────────

/** Returns the effective setting. When `enabled` is false, every other
 *  function in this file is inert. */
export function accountWarmPoolConfig(): AccountWarmPoolSetting {
  return accountWarmPoolSetting();
}

/** Convenience: is the subsystem armed? */
export function accountWarmPoolArmed(): boolean {
  return accountWarmPoolConfig().enabled;
}

// ─── Counts ─────────────────────────────────────────────────────────────────

export interface AccountPoolCounts {
  booting: number;
  parked: number;
  claiming: number;
  total: number;
  target: number;
}

/** Live counts of spares per account (any pool_state). */
export async function getAccountPoolCounts(
  accountId: string,
): Promise<AccountPoolCounts> {
  if (!accountWarmPoolArmed()) {
    return { booting: 0, parked: 0, claiming: 0, total: 0, target: 0 };
  }
  const rows = await db
    .select({
      poolState: sessionSandboxes.poolState,
      n: sql<number>`count(*)::int`,
    })
    .from(sessionSandboxes)
    .where(
      and(
        eq(sessionSandboxes.accountId, accountId),
        isNull(sessionSandboxes.projectId),
        sql`(session_sandboxes.metadata->>'warmSpare')::boolean = true`,
        ne(sessionSandboxes.status, 'archived'),
      ),
    )
    .groupBy(sessionSandboxes.poolState);

  const out: AccountPoolCounts = {
    booting: 0,
    parked: 0,
    claiming: 0,
    total: 0,
    target: accountWarmPoolConfig().size,
  };
  for (const r of rows) {
    if (r.poolState === 'parked') out.parked = r.n;
    else if (r.poolState === 'booting') out.booting = r.n;
    else if (r.poolState === 'claiming') out.claiming = r.n;
    out.total += r.n;
  }
  return out;
}

// ─── Spare provisioning ─────────────────────────────────────────────────────

/**
 * Provision one session-less spare for an account, using the platform
 * default sandbox template (no repo, no manifest). Boots the daemon's pool
 * mode (opencode + proxy up, parked, no session env).
 *
 * No-op when the feature flag is OFF.
 */
async function spawnSpareForAccount(
  accountId: string,
  targetSize: number,
): Promise<void> {
  if (!accountWarmPoolArmed()) return;

  const spareId = randomUUID();
  const provider = await selectProvider();
  try {
    const sandboxKey = await createApiKey({
      sandboxId: spareId,
      accountId,
      title: 'Warm Spare Token (account pool)',
      type: 'sandbox',
    });

    await db.insert(sessionSandboxes).values({
      sandboxId: spareId,
      sessionId: spareId, // sentinel; real session id bound at claim
      accountId,
      projectId: null, // session-only mode: no project
      provider,
      externalId: null,
      status: 'provisioning',
      poolState: 'booting',
      baseUrl: null,
      config: { serviceKey: sandboxKey.secretKey },
      metadata: {
        warmSpare: true,
        warmSpareSlug: DEFAULT_SANDBOX_SLUG,
        accountPool: true,
      },
    });

    const image = await ensureSandboxImage(
      ACCOUNT_POOL_PROJECT_SHELL,
      { slug: DEFAULT_SANDBOX_SLUG, accountId, source: 'background', provider },
    );

    const result = await getProvider(provider).create({
      accountId,
      userId: '',
      name: `warm-acct-${spareId.slice(0, 8)}`,
      envVars: {
        KORTIX_WARM_POOL: '1',
        KORTIX_TOKEN: sandboxKey.secretKey,
      },
      snapshot: image.snapshotName,
      autoStopInterval: 0, // stay up until claimed/reaped
    });

    await db
      .update(sessionSandboxes)
      .set({ externalId: result.externalId, baseUrl: result.baseUrl || null, updatedAt: new Date() })
      .where(eq(sessionSandboxes.sandboxId, spareId));

    void promoteSpareWhenReady(spareId, result.externalId).catch(() => {});
    console.log(
      `[warm-pool-account] spawned spare ${spareId.slice(0, 8)} for account ${accountId.slice(0, 8)} (target ${targetSize})`,
    );
  } catch (err) {
    console.warn(
      `[warm-pool-account] spawn spare ${spareId.slice(0, 8)} failed:`,
      err instanceof Error ? err.message : err,
    );
    await db
      .update(sessionSandboxes)
      .set({ status: 'error', updatedAt: new Date() })
      .where(eq(sessionSandboxes.sandboxId, spareId))
      .catch(() => {});
  }
}

/**
 * Poll the spare's daemon /kortix/health until it reports ready, then flip
 * pool_state='parked'. Times out after POOL_BOOT_TIMEOUT_MS (reaped by
 * reconcile). Mirrors the project-scoped promoteSpareWhenReady pattern.
 */
async function promoteSpareWhenReady(
  spareId: string,
  externalId: string,
): Promise<void> {
  const { resolvePreviewLink } = await import('../../sandbox-proxy/backend');
  const deadline = Date.now() + POOL_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, READY_PROBE_INTERVAL_MS));
    const [row] = await db
      .select({
        poolState: sessionSandboxes.poolState,
        status: sessionSandboxes.status,
      })
      .from(sessionSandboxes)
      .where(eq(sessionSandboxes.sandboxId, spareId))
      .limit(1);
    if (!row || row.poolState !== 'booting') return; // claimed/reaped/gone
    if (row.status === 'error') return;
    // /kortix/health bypasses the daemon AUTH gate, so it answers before
    // claim — but Daytona's preview PROXY still gates on the per-link preview
    // token, so a tokenless fetch gets HTTP 400 and never sees the daemon.
    // Send the preview token + skip-warning header (same as the project-scoped path).
    let healthy = false;
    try {
      const { url, token } = await resolvePreviewLink(externalId, DAEMON_PORT);
      const headers: Record<string, string> = {
        'X-Daytona-Skip-Preview-Warning': 'true',
      };
      if (token) headers['X-Daytona-Preview-Token'] = token;
      const res = await fetch(`${url.replace(/\/$/, '')}/kortix/health`, {
        headers,
        signal: AbortSignal.timeout(8_000),
      });
      // Session-only mode spares don't clone a repo, so basic health (not
      // runtimeReady) is enough — the daemon just needs to be up.
      healthy = res.ok;
    } catch {
      healthy = false;
    }
    if (healthy) {
      await db
        .update(sessionSandboxes)
        .set({
          poolState: 'parked',
          status: 'active',
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(sessionSandboxes.sandboxId, spareId));
      console.log(`[warm-pool-account] parked spare ${spareId.slice(0, 8)}`);
      return;
    }
  }
  console.warn(
    `[warm-pool-account] spare ${spareId.slice(0, 8)} never became ready → leaving for boot-timeout reap`,
  );
}

// ─── Claim path ─────────────────────────────────────────────────────────────

export interface ClaimAccountSpareInput {
  sessionId: string;
  accountId: string;
}

/**
 * Atomically grab a parked spare for the account, stage the session env,
 * and bind the spare's external_id to the session id. Returns the
 * externalId/baseUrl/provider to use, or null on any miss/error (caller
 * falls back to cold provisioning).
 *
 * No-op (returns null) when the feature flag is OFF.
 */
export async function claimSpareForAccountSession(
  input: ClaimAccountSpareInput,
): Promise<{ externalId: string; baseUrl: string; provider: string } | null> {
  if (!accountWarmPoolArmed()) return null;
  if (!input.sessionId || !input.accountId) return null;

  // Account must be in good standing (mirror the project-scoped gate).
  try {
    if (!(await accountEntitledToLlmGateway(input.accountId))) return null;
    if (!(await checkBillingActive(input.accountId))) return null;
  } catch {
    return null;
  }

  // Atomic claim: grab one parked spare for this account.
  const claimed = await db.execute(sql`
    WITH claimed AS (
      SELECT sandbox_id FROM kortix.session_sandboxes
      WHERE account_id = ${input.accountId}
        AND project_id IS NULL
        AND pool_state = 'parked'
        AND status = 'active'
        AND (metadata->>'warmSpare')::boolean = true
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE kortix.session_sandboxes
    SET pool_state = 'claiming', updated_at = now()
    FROM claimed
    WHERE session_sandboxes.sandbox_id = claimed.sandbox_id
    RETURNING session_sandboxes.sandbox_id, session_sandboxes.external_id,
              session_sandboxes.base_url, session_sandboxes.provider,
              session_sandboxes.config
  `);

  const row = (claimed.rows as Array<{
    sandbox_id: string;
    external_id: string | null;
    base_url: string | null;
    provider: string;
    config: unknown;
  }>)?.[0];
  if (!row || !row.external_id || !row.base_url) return null;

  try {
    return await bindClaimedAccountSpare({
      spareId: row.sandbox_id,
      sessionId: input.sessionId,
      accountId: input.accountId,
      externalId: row.external_id,
      baseUrl: row.base_url,
      provider: row.provider,
      config: row.config,
    });
  } catch (err) {
    console.warn(
      `[warm-pool-account] bindClaimed failed for session ${input.sessionId.slice(0, 8)}:`,
      err instanceof Error ? err.message : err,
    );
    // Release the claim so reconcile reaps it.
    await db
      .update(sessionSandboxes)
      .set({ poolState: 'reap', updatedAt: new Date() })
      .where(eq(sessionSandboxes.sandboxId, row.sandbox_id))
      .catch(() => {});
    return null;
  }
}

interface BindClaimedInput {
  spareId: string;
  sessionId: string;
  accountId: string;
  externalId: string;
  baseUrl: string;
  provider: string;
  config: unknown;
}

async function bindClaimedAccountSpare(
  input: BindClaimedInput,
): Promise<{ externalId: string; baseUrl: string; provider: string }> {
  const cfg = (input.config as { serviceKey?: string } | null) ?? {};
  const parkKey = cfg.serviceKey ?? '';

  // Mint the session's API key + account token (so the proxy + daemon can
  // authenticate the user's session).
  const sandboxKey = await createApiKey({
    sandboxId: input.sessionId,
    accountId: input.accountId,
    title: 'Session Sandbox Token',
    type: 'sandbox',
  });
  // Mint an executor-side account token bound to this session — the LLM
  // gateway attributes usage to it (sessionId == sandboxId by construction).
  let executorToken: string | null = null;
  try {
    const tok = await createAccountToken({
      accountId: input.accountId,
      userId: '', // session-only mode — no per-user attribution
      projectId: undefined, // user-scoped (no project)
      sessionId: input.sessionId,
      name: `Executor Session ${input.sessionId.slice(0, 8)}`,
    });
    executorToken = tok.secretKey;
  } catch (err) {
    console.warn(
      `[warm-pool-account] executor token mint failed:`,
      err instanceof Error ? err.message : err,
    );
  }
  // Prefer the executor token if minted (carries session attribution);
  // otherwise fall back to the sandbox key (the daemon just needs SOMETHING
  // to authenticate to the proxy).
  const sessionToken = executorToken ?? sandboxKey.secretKey;

  // Stage the session env into the box via the daemon's /file/upload. The
  // daemon's env-poll clones + warms on the next tick.
  const sessionEnv = [
    `KORTIX_TOKEN=${sessionToken}`,
    `KORTIX_SESSION_ID=${input.sessionId}`,
    `KORTIX_ACCOUNT_ID=${input.accountId}`,
  ].join('\n');
  try {
    const { resolvePreviewLink } = await import('../../sandbox-proxy/backend');
    const { url, token } = await resolvePreviewLink(input.externalId, DAEMON_PORT);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Daytona-Skip-Preview-Warning': 'true',
      Authorization: `Bearer ${parkKey}`,
    };
    if (token) headers['X-Daytona-Preview-Token'] = token;
    await fetch(`${url.replace(/\/$/, '')}/file/upload`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/tmp/pt-env',
        content: Buffer.from(sessionEnv).toString('base64'),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.warn(
      `[warm-pool-account] /file/upload failed (continuing — daemon will pick up env via poll):`,
      err instanceof Error ? err.message : err,
    );
  }

  // Bind the spare to the session id — single transaction.
  await db.transaction(async (tx) => {
    // Re-scope the api_keys.sandbox_id from the spare id to the session id.
    await tx
      .update(kortixApiKeys)
      .set({ sandboxId: input.sessionId })
      .where(eq(kortixApiKeys.sandboxId, input.spareId));

    // Insert the real session_sandboxes row keyed sandbox_id == session_id.
    await tx.insert(sessionSandboxes).values({
      sandboxId: input.sessionId,
      sessionId: input.sessionId,
      accountId: input.accountId,
      projectId: null,
      provider: input.provider,
      externalId: input.externalId,
      baseUrl: input.baseUrl,
      status: 'active',
      poolState: null,
      config: { serviceKey: sessionToken },
      metadata: {
        claimed_from_spare: input.spareId,
        accountPool: true,
      },
    });

    // Remove the spare row (its sandbox_id has been re-bound to the session).
    await tx
      .delete(sessionSandboxes)
      .where(eq(sessionSandboxes.sandboxId, input.spareId));
  });

  return {
    externalId: input.externalId,
    baseUrl: input.baseUrl,
    provider: input.provider,
  };
}

// ─── Presence (account heartbeats) ─────────────────────────────────────────

/**
 * Mark this account as recently active. The leader reconcile uses this to
 * decide which accounts to keep warm. Called when a session is opened.
 *
 * No-op when the feature flag is OFF.
 */
export async function noteAccountPoolPresence(
  accountId: string,
): Promise<void> {
  if (!accountWarmPoolArmed()) return;
  const target = accountWarmPoolConfig().size;
  await db
    .insert(accountWarmPoolPresence)
    .values({
      accountId,
      lastSeenAt: new Date(),
      targetSize: target,
    })
    .onConflictDoUpdate({
      target: accountWarmPoolPresence.accountId,
      set: {
        lastSeenAt: new Date(),
        targetSize: target,
      },
    })
    .catch(() => {});
}

/**
 * Drop this account's presence row AND reap all its parked/booting spares.
 * Called when the user explicitly stops using the platform (e.g. logs out,
 * closes the last session). In practice we usually let presence age out via
 * reconcile, but this is the explicit shutdown path.
 *
 * No-op when the feature flag is OFF.
 */
export async function dropAccountPoolPresence(
  accountId: string,
): Promise<void> {
  if (!accountWarmPoolArmed()) return;
  await db
    .delete(accountWarmPoolPresence)
    .where(eq(accountWarmPoolPresence.accountId, accountId))
    .catch(() => {});
  await reapAccountSpares(accountId).catch(() => {});
}

// ─── Reap + refill ──────────────────────────────────────────────────────────

async function reapWarmSandbox(row: {
  sandboxId: string;
  externalId: string | null;
  provider: string;
}): Promise<void> {
  try {
    if (row.externalId) {
      await getProvider(row.provider as any).remove(row.externalId);
    }
  } catch (err) {
    console.warn(
      `[warm-pool-account] provider remove failed for ${row.sandboxId.slice(0, 8)}:`,
      err instanceof Error ? err.message : err,
    );
  }
  await db
    .delete(sessionSandboxes)
    .where(eq(sessionSandboxes.sandboxId, row.sandboxId))
    .catch(() => {});
}

/**
 * Reap all spares for an account (used on presence drop / shutdown).
 * No-op when the feature flag is OFF.
 */
export async function reapAccountSpares(accountId: string): Promise<void> {
  if (!accountWarmPoolArmed()) return;
  const rows = await db
    .select({
      sandboxId: sessionSandboxes.sandboxId,
      externalId: sessionSandboxes.externalId,
      provider: sessionSandboxes.provider,
    })
    .from(sessionSandboxes)
    .where(
      and(
        eq(sessionSandboxes.accountId, accountId),
        isNull(sessionSandboxes.projectId),
        inArray(sessionSandboxes.poolState, [
          'booting',
          'parked',
          'claiming',
          'reap',
        ]),
      ),
    );
  for (const r of rows) {
    await reapWarmSandbox(r);
  }
}

interface PoolRow {
  sandboxId: string;
  externalId: string | null;
  provider: string;
  poolState: string | null;
  status: string;
  metadata: unknown;
  updatedAt: Date;
  createdAt: Date;
}

function warmBoxReapReason(
  row: PoolRow,
  now: Date,
): string | null {
  if (!row.poolState) return null; // not a pool box
  if (row.poolState === 'reap') return 'marked';
  if (row.status === 'error') return 'errored';
  if (row.poolState === 'booting' && now.getTime() - row.updatedAt.getTime() > POOL_BOOT_TIMEOUT_MS) {
    return 'boot-timeout';
  }
  if (row.poolState === 'claiming' && now.getTime() - row.updatedAt.getTime() > CLAIM_STALE_MS) {
    return 'claim-stale';
  }
  if (now.getTime() - row.createdAt.getTime() > POOL_MAX_AGE_MS) {
    return 'aged-out';
  }
  return null;
}

/**
 * Refill the pool toward the account's target size. Called by reconcile
 * and after a successful claim.
 *
 * No-op when the feature flag is OFF.
 */
export async function refillAccountPool(accountId: string): Promise<void> {
  if (!accountWarmPoolArmed()) return;
  const counts = await getAccountPoolCounts(accountId);
  const target = accountWarmPoolConfig().size;
  const deficit = Math.max(0, target - counts.total);
  if (deficit === 0) return;
  // Spawn one at a time — reconcile will pick up the rest on its next tick
  // to avoid thundering herds.
  await spawnSpareForAccount(accountId, target);
}

// ─── Reconcile (leader-only) ────────────────────────────────────────────────

/**
 * Periodic leader-only sweep. Called by the maintenance loop. Prunes stale
 * presence, reaps dead spares, refills present accounts.
 *
 * No-op when the feature flag is OFF (returns immediately).
 */
export async function reconcileAccountWarmPool(now = new Date()): Promise<void> {
  if (!accountWarmPoolArmed()) return;

  // 1. Drop stale presence rows (no sessions for this account in the last
  //    PRESENCE_TTL_MS — release the warm pool).
  const presenceCutoff = new Date(now.getTime() - PRESENCE_TTL_MS);
  await db
    .delete(accountWarmPoolPresence)
    .where(lt(accountWarmPoolPresence.lastSeenAt, presenceCutoff))
    .catch(() => {});

  // 2. Reap dead/aged spares across all accounts.
  const poolRows = await db
    .select({
      sandboxId: sessionSandboxes.sandboxId,
      externalId: sessionSandboxes.externalId,
      provider: sessionSandboxes.provider,
      poolState: sessionSandboxes.poolState,
      status: sessionSandboxes.status,
      metadata: sessionSandboxes.metadata,
      updatedAt: sessionSandboxes.updatedAt,
      createdAt: sessionSandboxes.createdAt,
      accountId: sessionSandboxes.accountId,
    })
    .from(sessionSandboxes)
    .where(
      and(
        isNull(sessionSandboxes.projectId),
        sql`(session_sandboxes.metadata->>'warmSpare')::boolean = true`,
        inArray(sessionSandboxes.poolState, [
          'booting',
          'parked',
          'claiming',
          'reap',
        ]),
      ),
    );

  const reapedAccountIds = new Set<string>();
  for (const r of poolRows) {
    const reason = warmBoxReapReason(r as PoolRow, now);
    if (reason) {
      console.log(
        `[warm-pool-account] reaping ${r.sandboxId.slice(0, 8)} (${reason})`,
      );
      await reapWarmSandbox({
        sandboxId: r.sandboxId,
        externalId: r.externalId,
        provider: r.provider,
      });
      if (r.accountId) reapedAccountIds.add(r.accountId);
    }
  }

  // 3. Refill present accounts toward their target size.
  const present = await db
    .select({
      accountId: accountWarmPoolPresence.accountId,
      lastSeenAt: accountWarmPoolPresence.lastSeenAt,
      targetSize: accountWarmPoolPresence.targetSize,
    })
    .from(accountWarmPoolPresence)
    .where(gte(accountWarmPoolPresence.lastSeenAt, presenceCutoff));

  for (const p of present) {
    try {
      await refillAccountPool(p.accountId);
    } catch (err) {
      console.warn(
        `[warm-pool-account] refill failed for account ${p.accountId.slice(0, 8)}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

// ─── Admin stats (for /admin/sandbox-pool/* endpoints) ──────────────────────

export interface AccountPoolStats {
  enabled: boolean;
  total_accounts_warm: number;
  total_spares: number;
  parked: number;
  booting: number;
  claiming: number;
  reap: number;
  target_size_default: number;
  last_reconcile_at: string | null;
}

export async function getAccountPoolStats(): Promise<AccountPoolStats> {
  if (!accountWarmPoolArmed()) {
    return {
      enabled: false,
      total_accounts_warm: 0,
      total_spares: 0,
      parked: 0,
      booting: 0,
      claiming: 0,
      reap: 0,
      target_size_default: accountWarmPoolConfig().size,
      last_reconcile_at: null,
    };
  }
  const [accountCount, poolCounts] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(accountWarmPoolPresence),
    db
      .select({
        poolState: sessionSandboxes.poolState,
        n: sql<number>`count(*)::int`,
      })
      .from(sessionSandboxes)
      .where(
        and(
          isNull(sessionSandboxes.projectId),
          sql`(session_sandboxes.metadata->>'warmSpare')::boolean = true`,
        ),
      )
      .groupBy(sessionSandboxes.poolState),
  ]);

  const counts = { parked: 0, booting: 0, claiming: 0, reap: 0 };
  let totalSpares = 0;
  for (const r of poolCounts) {
    if (r.poolState === 'parked') counts.parked = r.n;
    else if (r.poolState === 'booting') counts.booting = r.n;
    else if (r.poolState === 'claiming') counts.claiming = r.n;
    else if (r.poolState === 'reap') counts.reap = r.n;
    totalSpares += r.n;
  }

  return {
    enabled: true,
    total_accounts_warm: accountCount[0]?.n ?? 0,
    total_spares: totalSpares,
    parked: counts.parked,
    booting: counts.booting,
    claiming: counts.claiming,
    reap: counts.reap,
    target_size_default: accountWarmPoolConfig().size,
    last_reconcile_at: new Date().toISOString(),
  };
}

export interface AccountPoolSandboxRow {
  sandboxId: string;
  accountId: string;
  provider: string;
  externalId: string | null;
  status: string;
  poolState: string | null;
  baseUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listAccountPoolSandboxes(
  limit = 50,
): Promise<AccountPoolSandboxRow[]> {
  if (!accountWarmPoolArmed()) return [];
  const rows = await db
    .select({
      sandboxId: sessionSandboxes.sandboxId,
      accountId: sessionSandboxes.accountId,
      provider: sessionSandboxes.provider,
      externalId: sessionSandboxes.externalId,
      status: sessionSandboxes.status,
      poolState: sessionSandboxes.poolState,
      baseUrl: sessionSandboxes.baseUrl,
      createdAt: sessionSandboxes.createdAt,
      updatedAt: sessionSandboxes.updatedAt,
    })
    .from(sessionSandboxes)
    .where(
      and(
        isNull(sessionSandboxes.projectId),
        sql`(session_sandboxes.metadata->>'warmSpare')::boolean = true`,
      ),
    )
    .orderBy(sql`session_sandboxes.created_at DESC`)
    .limit(limit);

  return rows.map((r) => ({
    sandboxId: r.sandboxId,
    accountId: r.accountId,
    provider: r.provider,
    externalId: r.externalId,
    status: r.status,
    poolState: r.poolState,
    baseUrl: r.baseUrl,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}
