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

/**
 * Reconcile the `computer` connector for an account — works in session-only
 * mode (no projectId required). Called by:
 *   - tunnel/routes/connections.ts (POST /connections, DELETE /:id)
 *   - tunnel/routes/device-auth.ts (POST /:code/approve)
 *   - tunnel/index.ts (on agent:connect / agent:disconnect events)
 *
 * In session-only mode, there's no project to fan out to. We upsert/delete
 * the `computer` connector directly on the account. The connector row has
 * projectId = null (account-scoped).
 *
 * Behavior:
 *   - If the account has ≥1 tunnel_connection → upsert the `computer` connector
 *     (with the full computer catalog from computers.ts).
 *   - If the account has 0 tunnels → delete the `computer` connector.
 *
 * Idempotent: safe to call on every connect/disconnect event.
 */
export async function reconcileAccountComputerConnector(accountId: string): Promise<void> {
  try {
    if (!config.TUNNEL_ENABLED) return;

    // Check if the account has any tunnels
    const [tunnel] = await db
      .select({ tunnelId: tunnelConnections.tunnelId })
      .from(tunnelConnections)
      .where(eq(tunnelConnections.accountId, accountId))
      .limit(1);

    // Import here to avoid circular deps at module load
    const { executorConnectors, executorConnectorActions } = await import('@kortix/db');
    const { computerCatalog } = await import('./computers');
    const { manifestHashForConnector } = await import('../shared');
    const { and, isNull } = await import('drizzle-orm');

    // Find existing computer connector for this account (projectId IS NULL)
    const [existingConnector] = await db
      .select({
        connectorId: executorConnectors.connectorId,
      })
      .from(executorConnectors)
      .where(
        and(
          eq(executorConnectors.accountId, accountId),
          eq(executorConnectors.slug, COMPUTER_SLUG),
          isNull(executorConnectors.projectId),
        ),
      )
      .limit(1);

    if (tunnel) {
      // Account has ≥1 tunnel → ensure the computer connector exists
      const spec = computerSpec();
      const actions = computerCatalog();
      const manifestHash = manifestHashForConnector(spec);

      if (existingConnector) {
        // Update existing connector + refresh actions
        await db
          .update(executorConnectors)
          .set({
            name: spec.name,
            enabled: true,
            manifestHash,
            status: 'active',
            lastError: null,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(executorConnectors.connectorId, existingConnector.connectorId));

        // Refresh actions (delete + reinsert)
        await db
          .delete(executorConnectorActions)
          .where(eq(executorConnectorActions.connectorId, existingConnector.connectorId));
        if (actions.length > 0) {
          await db.insert(executorConnectorActions).values(
            actions.map((a) => ({
              connectorId: existingConnector.connectorId,
              path: a.path,
              name: a.name,
              description: a.description,
              risk: a.risk as any,
              inputSchema: a.inputSchema as any,
              outputSchema: a.outputSchema as any,
            })),
          );
        }
      } else {
        // Insert new (account-scoped, projectId = null)
        const [created] = await db
          .insert(executorConnectors)
          .values({
            accountId,
            projectId: null,
            slug: spec.slug,
            name: spec.name,
            providerType: 'computer' as any,
            enabled: true,
            credentialMode: 'shared' as any,
            manifestHash,
            status: 'active',
            config: {
              auth: { type: 'none', in: 'header', name: null, prefix: null, secret: null },
              baseUrl: null,
            } as any,
            shareScope: 'project' as any,
          })
          .returning({ connectorId: executorConnectors.connectorId });

        // Insert actions
        if (created && actions.length > 0) {
          await db.insert(executorConnectorActions).values(
            actions.map((a) => ({
              connectorId: created.connectorId,
              path: a.path,
              name: a.name,
              description: a.description,
              risk: a.risk as any,
              inputSchema: a.inputSchema as any,
              outputSchema: a.outputSchema as any,
            })),
          );
        }
      }
      console.log(`[executor] computer connector reconciled for account ${accountId} (tunnel online)`);
    } else {
      // Account has 0 tunnels → delete the computer connector
      if (existingConnector) {
        await db
          .delete(executorConnectorActions)
          .where(eq(executorConnectorActions.connectorId, existingConnector.connectorId));
        await db
          .delete(executorConnectors)
          .where(eq(executorConnectors.connectorId, existingConnector.connectorId));
        console.log(`[executor] computer connector removed for account ${accountId} (no tunnels)`);
      }
    }
  } catch (e) {
    console.warn('[executor] account computer connector reconcile failed', {
      accountId,
      err: (e as Error).message,
    });
  }
}
