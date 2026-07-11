import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Pool + timeout defaults for the postgres.js client.
 *
 * Updated 2026-07-11: VaelorX uses Supabase Supavisor pooler (port 5432 by
 * default) which has a hard cap of 15 connections on the free tier. With
 * DB_POOL_MAX=15, the API alone saturated the entire pool, causing every
 * subsequent query to fail with EMAXCONNSESSION. The fixes below are now
 * the DEFAULTS (not just env overrides) so the system works correctly out
 * of the box without requiring manual env var configuration.
 *
 * Three layers of protection:
 *   1. Auto-promote Supabase pooler URL from port 5432 → 6543 (transaction
 *      pooler) which supports 200+ concurrent connections.
 *   2. Lower DB_POOL_MAX default from 15 → 8 so even without the URL
 *      rewrite, the API cannot exhaust a 15-conn session pool.
 *   3. statement_timeout + idle_timeout prevent stuck queries from pinning
 *      connections indefinitely.
 */
const POOL_MAX = intFromEnv('DB_POOL_MAX', 8);
const IDLE_TIMEOUT_S = intFromEnv('DB_IDLE_TIMEOUT_S', 15);
const CONNECT_TIMEOUT_S = intFromEnv('DB_CONNECT_TIMEOUT_S', 10);
const MAX_LIFETIME_S = intFromEnv('DB_MAX_LIFETIME_S', 60 * 30); // 30 min
const STATEMENT_TIMEOUT_MS = intFromEnv('DB_STATEMENT_TIMEOUT_MS', 15_000);

/**
 * Promote a Supabase Supavisor session-mode pooler URL (port 5432) to the
 * transaction-mode pooler (port 6543) which has a much higher concurrency cap.
 *
 * On the Supabase free tier, the session pooler has a hard limit of 15
 * connections TOTAL across all clients. A single API pod with `max: 8` can
 * still exhaust that, causing EMAXCONNSESSION errors for every subsequent
 * query.
 *
 * The transaction pooler (port 6543) supports far higher concurrency (200+)
 * and only requires `prepare: false` (already set on the client) to work.
 *
 * This rewrite is a no-op for:
 *   - Direct Postgres URLs (db.<ref>.supabase.co:5432) — not a pooler
 *   - URLs already on port 6543 (idempotent)
 *   - Non-Supabase URLs
 *
 * Set `DB_DISABLE_POOLER_PROMOTE=1` to opt out (for debugging).
 */
function promoteToTransactionPooler(databaseUrl: string): string {
  if (process.env.DB_DISABLE_POOLER_PROMOTE === '1') return databaseUrl;
  if (!databaseUrl.includes('supabase')) return databaseUrl;
  if (!databaseUrl.includes('pooler')) return databaseUrl;
  return databaseUrl.replace(/:5432\//, ':6543/');
}

/**
 * Create a Drizzle database client.
 *
 * @param databaseUrl - PostgreSQL connection string
 * @param options - Additional postgres.js options (override the defaults below)
 * @returns Drizzle database client with full schema
 */
export function createDb(databaseUrl: string, options?: postgres.Options<{}>) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const effectiveUrl = promoteToTransactionPooler(databaseUrl);

  const client = postgres(effectiveUrl, {
    // prepare: false is REQUIRED for the Supabase transaction pooler (port 6543).
    // Supavisor multiplexes connections, so server-side prepared statements
    // can't be reused.
    prepare: false,
    max: POOL_MAX,
    idle_timeout: IDLE_TIMEOUT_S,
    connect_timeout: CONNECT_TIMEOUT_S,
    max_lifetime: MAX_LIFETIME_S,
    connection: {
      statement_timeout: STATEMENT_TIMEOUT_MS,
    },
    ...options,
  });

  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;
