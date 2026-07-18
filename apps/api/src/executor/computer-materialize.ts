/**
 * Auto-materialize the `computer` connector from connected machines.
 *
 * Like the `channel` connector, `computer` needs no `[[connectors]]` entry —
 * connecting a machine over the Agent Computer Tunnel IS the registration. When
 * an account has at least one tunnel (and the platform has the `agent_tunnel`
 * flag ON — default in session-only mode), we synthesize a SINGLE `computer`
 * ConnectorSpec here so the materializer treats it like any other connector (DB
 * rows, the fixed action catalog, sharing, policies, and the Executor/Connectors
 * surface). One connector fronts ALL the account's machines — the machine is a
 * call argument, resolved at call time. There is no credential: the live WS
 * relay is the credential, and per-machine auth/scope is the tunnel permission
 * layer. See docs/specs/computer-connector.md.
 *
 * Session-only mode: this function is now account-scoped (no projectId needed).
 * The `agent_tunnel` flag is checked at platform level (TUNNEL_ENABLED env var
 * + platformDefault=true in experimental/features.ts). Per-account overrides
 * can be added later via an `account_settings` table if needed.
 */
import { eq } from 'drizzle-orm';
import { tunnelConnections } from '@kortix/db';
import { db } from '../shared/db';
import { config } from '../config';
import { COMPUTER_SLUG, computerLabel } from './computers';
import type { ConnectorSpec } from '../shared';
import { MANIFEST_FILENAME } from '../shared';

function computerSpec(): ConnectorSpec {
  return {
    slug: COMPUTER_SLUG,
    path: `${MANIFEST_FILENAME}#connectors.${COMPUTER_SLUG} (auto: tunnel)`,
    name: computerLabel(),
    enabled: true,
    provider: 'computer',
    credentialMode: 'shared',
    app: null,
    account: null,
    url: null,
    transport: null,
    endpoint: null,
    baseUrl: null,
    platform: null,
    spec: null,
    auth: { type: 'none', in: 'header', name: null, prefix: null, secret: null },
    policies: [],
  };
}

/** True if a `computer` connector (or anything on its slug) is already declared. */
function alreadyDeclared(declared: ConnectorSpec[]): boolean {
  return declared.some((s) => s.slug === COMPUTER_SLUG || s.provider === 'computer');
}

/**
 * A single synthetic `computer` ConnectorSpec when this account has a
 * connected machine — never written to git, never shadowing an explicit
 * declaration. Returns `[]` otherwise.
 *
 * Session-only mode: account-scoped (no projectId required).
 */
export async function synthesizeComputerConnectors(
  accountId: string,
  declared: ConnectorSpec[],
): Promise<ConnectorSpec[]> {
  if (alreadyDeclared(declared)) return [];

  // Platform-level gate — if the operator disabled the tunnel service,
  // don't surface the connector. The `agent_tunnel` experimental flag
  // defaults to ON (see experimental/features.ts); flipping it to false
  // hides the feature globally without redeploying.
  if (!config.TUNNEL_ENABLED) return [];

  const [tunnel] = await db
    .select({ tunnelId: tunnelConnections.tunnelId })
    .from(tunnelConnections)
    .where(eq(tunnelConnections.accountId, accountId))
    .limit(1);
  if (!tunnel) return [];

  return [computerSpec()];
}

/**
 * Back-compat wrapper for callers that still pass a projectId.
 * Resolves the projectId → accountId, then delegates to the account-scoped
 * version. Used by legacy code paths that haven't been migrated yet.
 */
export async function synthesizeComputerConnectorsForProject(
  projectId: string,
  declared: ConnectorSpec[],
): Promise<ConnectorSpec[]> {
  if (alreadyDeclared(declared)) return [];
  if (!config.TUNNEL_ENABLED) return [];

  // Import here to avoid a circular dep at module load time
  const { projects } = await import('@kortix/db');
  const [proj] = await db
    .select({ accountId: projects.accountId })
    .from(projects)
    .where(eq(projects.projectId, projectId))
    .limit(1);
  if (!proj) return [];

  return synthesizeComputerConnectors(proj.accountId, declared);
}
