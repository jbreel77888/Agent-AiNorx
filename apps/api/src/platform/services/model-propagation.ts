/**
 * Model Propagation — broadcasts model changes to active sandboxes.
 *
 * When the admin changes the default model, this module pushes the update
 * to all active sandboxes via the Tensorlake SDK. The daemon receives the
 * new model via POST /kortix/model and updates process.env.KORTIX_DEFAULT_MODEL
 * in memory — the next prompt uses the new model immediately.
 *
 * For sandboxes running the NEW image (with model-update endpoint):
 *   POST /kortix/model { modelKey: "..." }
 *
 * For sandboxes running the OLD image (without the endpoint):
 *   Fallback: run `echo "$MODEL" > /tmp/kortix-model-update && kill -HUP $(pgrep kortix-agent)`
 *   via the Tensorlake SDK's run() method.
 */
import { db } from '../../shared/db';
import { sessionSandboxes, platformModels } from '@kortix/db';
import { eq, and } from 'drizzle-orm';

interface PropagationResult {
  total: number;
  updated: number;
  failed: number;
  errors: string[];
}

/**
 * Push a model update to a single sandbox.
 * Tries the new endpoint first, falls back to direct command execution.
 */
async function pushModelToSandbox(
  externalId: string,
  modelKey: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { Sandbox } = await import('../../shared/tensorlake');
    const sandbox = await Sandbox.connect({ sandboxId: externalId });

    // Try the new /kortix/model endpoint first (requires updated image)
    try {
      const { encodeKortixUserContext } = await import('../../shared/kortix-user-context');
      const { resolveServiceKey } = await import('../../sandbox-proxy/backend');
      const serviceKey = await resolveServiceKey(externalId);
      if (serviceKey) {
        const ctx = {
          userId: 'system',
          sandboxId: externalId,
          sandboxRole: 'owner' as const,
          scopes: ['*'],
        };
        const header = encodeKortixUserContext(ctx as any, serviceKey);

        const result = await sandbox.run('bash', {
          args: ['-c',
            `curl -s -X POST -H "Content-Type: application/json" -H "X-Kortix-User-Context: ${header}" ` +
            `-d '{"modelKey":"${modelKey}"}' http://127.0.0.1:8000/kortix/model 2>/dev/null || ` +
            // Fallback for old images: update env file + signal daemon
            `echo 'KORTIX_DEFAULT_MODEL=${modelKey}' >> /etc/pt-env && ` +
            `kill -HUP $(pgrep kortix-agent) 2>/dev/null; echo done`
          ],
          timeout: 10,
        });

        // Check if the command succeeded
        if (result.exitCode === 0) {
          return { ok: true };
        }
      }
    } catch {
      // /kortix/model not available — use fallback below
    }

    // Fallback: directly update the env + signal the daemon
    await sandbox.run('bash', {
      args: ['-c',
        `sed -i 's/^KORTIX_DEFAULT_MODEL=.*/KORTIX_DEFAULT_MODEL=${modelKey}/' /etc/pt-env 2>/dev/null || ` +
        `echo 'KORTIX_DEFAULT_MODEL=${modelKey}' >> /etc/pt-env; ` +
        `kill -HUP $(pgrep kortix-agent) 2>/dev/null; ` +
        `kill -USR1 $(pgrep opencode) 2>/dev/null; echo done`
      ],
      timeout: 10,
    });

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Propagate the default model change to all active sandboxes.
 *
 * Called by: POST /v1/admin/platform/models/:id/default
 */
export async function propagateDefaultModelToActiveSandboxes(
  modelKey: string,
): Promise<PropagationResult> {
  const errors: string[] = [];

  // Find all active sandboxes with external IDs
  const rows = await db
    .select({
      externalId: sessionSandboxes.externalId,
      sessionId: sessionSandboxes.sessionId,
    })
    .from(sessionSandboxes)
    .where(
      and(
        eq(sessionSandboxes.provider, 'tensorlake'),
        eq(sessionSandboxes.status, 'active'),
      ),
    );

  const targets = rows.filter(
    (r): r is { externalId: string; sessionId: string } => r.externalId !== null,
  );

  if (targets.length === 0) {
    return { total: 0, updated: 0, failed: 0, errors: [] };
  }

  // Also get the upstream model ID (the one the daemon actually uses)
  const [model] = await db
    .select({
      upstreamModelId: platformModels.upstreamModelId,
      modelKey: platformModels.modelKey,
    })
    .from(platformModels)
    .where(eq(platformModels.isDefault, true))
    .limit(1);

  const effectiveModelKey = model?.upstreamModelId || model?.modelKey || modelKey;

  // Push to each sandbox with concurrency limit
  const CONCURRENCY = 5;
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (sb) => {
        const result = await pushModelToSandbox(sb.externalId, effectiveModelKey);
        if (!result.ok) {
          throw new Error(`Sandbox ${sb.externalId}: ${result.error}`);
        }
        return sb.externalId;
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        updated++;
        console.log(`[model-propagation] Updated sandbox: ${result.value}`);
      } else {
        failed++;
        errors.push(result.reason?.message || 'Unknown error');
        console.warn(`[model-propagation] Failed: ${result.reason?.message}`);
      }
    }
  }

  console.log(
    `[model-propagation] Model "${effectiveModelKey}" pushed to ${updated}/${targets.length} sandboxes`,
  );

  return { total: targets.length, updated, failed, errors };
}
