import { config } from '../../config';

/**
 * DB-backed runtime toggles operators flip from the admin Providers panel —
 * NOT env vars. Stored in kortix.platform_settings (key -> jsonb value),
 * mirroring provider_distribution (provider-balancer.ts).
 *
 * Read through a SYNC accessor backed by a 30s-TTL cache that refreshes in the
 * background, so hot paths (warmPoolEnabled, warmSnapshotEnabled, provider
 * failover) never block on the DB. The admin PUT awaits refreshRuntimeSettings()
 * after writing, so a toggle takes effect immediately for the writing process;
 * other processes pick it up within the TTL.
 *
 * Fail-safe defaults: warm_pool + provider_fallback default OFF (spares/handoff
 * cost resources). warm_snapshot defaults ON — it's a pure latency optimization
 * (a failed bake degrades to a cold clone, never a broken session), so a DB
 * hiccup / missing row / cold cache resolving to "on" is the SAFE direction.
 */

export const WARM_POOL_KEY = 'warm_pool';
export const PROVIDER_FALLBACK_KEY = 'provider_fallback';
export const WARM_SNAPSHOT_KEY = 'warm_snapshot';

/**
 * Session-only-mode feature flags. Both ship OFF — the code paths are built
 * and ready, but the surfaces stay dark until an operator explicitly flips
 * them on (admin panel). This lets us ship the code now and light it up
 * later without a redeploy.
 */
export const ACCOUNT_WARM_POOL_KEY = 'account_warm_pool';
export const ACCOUNT_DEPLOYMENTS_KEY = 'account_deployments';

export interface WarmPoolSetting {
  /** Master gate. OFF = the warm pool subsystem is inert (no spares, every
   *  create cold-provisions). Per-template opt-in is AND-gated on this. */
  enabled: boolean;
  /** Default ready-count a template gets when first opted in (UI overrides). */
  size: number;
}
export interface ProviderFallbackSetting {
  /** When ON, a provider that fails to provision a session AT BIRTH hands off
   *  once to the next allowed provider before the session is marked failed. */
  enabled: boolean;
}
export interface WarmSnapshotSetting {
  /** Master gate for per-project warm-fork snapshots (the ~2s session start).
   *  ON by default — pure upside (a failed bake degrades to a cold clone). The
   *  per-provider sub-gates still apply: daytona also needs a warm target,
   *  platinum also needs a configured host (see shared/daytona warmSnapshots*). */
  enabled: boolean;
}
/**
 * Account-scoped warm pool (session-only mode). When OFF, the account warm
 * pool subsystem is inert — no spares spawn, every session cold-provisions,
 * the admin /admin/sandbox-pool endpoints return {status:'disabled'}.
 *
 * Default OFF. Operators flip it on from the admin panel after reviewing the
 * cost implications (warm spares run 24/7).
 */
export interface AccountWarmPoolSetting {
  enabled: boolean;
  /** Default pool size per account (capped at MAX_WARM_SIZE). */
  size: number;
}
/**
 * Account-scoped deployments (session-only mode). When OFF, all
 * /v1/deployments routes return 503 'feature disabled'. When ON, users can
 * deploy code from their session sandboxes to Freestyle.sh and get a
 * permanent URL.
 *
 * Default OFF. Operators flip it on after configuring FREESTYLE_API_KEY.
 */
export interface AccountDeploymentsSetting {
  enabled: boolean;
}

const TTL_MS = 30_000;
const MAX_WARM_SIZE = 25;

/** Env is only the FALLBACK default now; the DB row is the real control surface,
 *  so operators never redeploy to toggle these. warm_pool/fallback ship OFF,
 *  warm_snapshot ships ON, account_warm_pool + account_deployments ship OFF
 *  (built-but-dormant until an operator flips them on). */
function envDefaults(): {
  warmPool: WarmPoolSetting;
  fallback: ProviderFallbackSetting;
  warmSnapshot: WarmSnapshotSetting;
  accountWarmPool: AccountWarmPoolSetting;
  accountDeployments: AccountDeploymentsSetting;
} {
  return {
    warmPool: { enabled: config.KORTIX_WARM_POOL_ENABLED, size: Math.max(0, config.KORTIX_WARM_POOL_SIZE) },
    fallback: { enabled: false },
    warmSnapshot: { enabled: true },
    accountWarmPool: { enabled: false, size: 3 },
    accountDeployments: { enabled: false },
  };
}

let cache: {
  warmPool: WarmPoolSetting;
  fallback: ProviderFallbackSetting;
  warmSnapshot: WarmSnapshotSetting;
  accountWarmPool: AccountWarmPoolSetting;
  accountDeployments: AccountDeploymentsSetting;
  at: number;
} | null = null;
let inflight: Promise<void> | null = null;

export async function refreshRuntimeSettings(): Promise<void> {
  const def = envDefaults();
  let warmPool = def.warmPool;
  let fallback = def.fallback;
  let warmSnapshot = def.warmSnapshot;
  let accountWarmPool = def.accountWarmPool;
  let accountDeployments = def.accountDeployments;
  try {
    const { hasDatabase, db } = await import('../../shared/db');
    if (hasDatabase) {
      const { platformSettings } = await import('@kortix/db');
      const { inArray } = await import('drizzle-orm');
      const rows = await db
        .select({ key: platformSettings.key, value: platformSettings.value })
        .from(platformSettings)
        .where(inArray(platformSettings.key, [
          WARM_POOL_KEY, PROVIDER_FALLBACK_KEY, WARM_SNAPSHOT_KEY,
          ACCOUNT_WARM_POOL_KEY, ACCOUNT_DEPLOYMENTS_KEY,
        ]));
      for (const r of rows) {
        const v = r.value as Record<string, unknown> | null;
        if (!v || typeof v !== 'object') continue;
        if (r.key === WARM_POOL_KEY) {
          const size =
            typeof v.size === 'number' && Number.isInteger(v.size) && v.size >= 0
              ? Math.min(v.size, MAX_WARM_SIZE)
              : def.warmPool.size;
          warmPool = { enabled: v.enabled === true, size };
        } else if (r.key === PROVIDER_FALLBACK_KEY) {
          fallback = { enabled: v.enabled === true };
        } else if (r.key === WARM_SNAPSHOT_KEY) {
          // A row is authoritative (enabled may be explicitly false). With NO row,
          // the env default (ON) stands — warm-fork is on out of the box.
          warmSnapshot = { enabled: v.enabled === true };
        } else if (r.key === ACCOUNT_WARM_POOL_KEY) {
          const size =
            typeof v.size === 'number' && Number.isInteger(v.size) && v.size >= 0
              ? Math.min(v.size, MAX_WARM_SIZE)
              : def.accountWarmPool.size;
          accountWarmPool = { enabled: v.enabled === true, size };
        } else if (r.key === ACCOUNT_DEPLOYMENTS_KEY) {
          accountDeployments = { enabled: v.enabled === true };
        }
      }
    }
  } catch {
    /* DB hiccup -> env defaults (warm_pool/fallback OFF, warm_snapshot ON,
       account_warm_pool + account_deployments OFF) */
  }
  cache = { warmPool, fallback, warmSnapshot, accountWarmPool, accountDeployments, at: Date.now() };
}

function ensureFresh(): void {
  if (cache && Date.now() - cache.at < TTL_MS) return;
  if (!inflight) inflight = refreshRuntimeSettings().finally(() => { inflight = null; });
}

export function warmPoolSetting(): WarmPoolSetting {
  ensureFresh();
  return cache?.warmPool ?? envDefaults().warmPool;
}

export function providerFallbackSetting(): ProviderFallbackSetting {
  ensureFresh();
  return cache?.fallback ?? envDefaults().fallback;
}

export function warmSnapshotSetting(): WarmSnapshotSetting {
  ensureFresh();
  return cache?.warmSnapshot ?? envDefaults().warmSnapshot;
}

/**
 * Account-scoped warm pool (session-only mode). Default OFF.
 * When OFF, the warm-pool-account.ts subsystem is inert and the
 * /admin/sandbox-pool endpoints report status='disabled'.
 */
export function accountWarmPoolSetting(): AccountWarmPoolSetting {
  ensureFresh();
  return cache?.accountWarmPool ?? envDefaults().accountWarmPool;
}

/**
 * Account-scoped deployments (session-only mode). Default OFF.
 * When OFF, all /v1/deployments routes return 503 'feature disabled'.
 */
export function accountDeploymentsSetting(): AccountDeploymentsSetting {
  ensureFresh();
  return cache?.accountDeployments ?? envDefaults().accountDeployments;
}

export function invalidateRuntimeSettings(): void {
  cache = null;
}
