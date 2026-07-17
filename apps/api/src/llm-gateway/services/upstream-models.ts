/**
 * Upstream Models — returns the model catalog from the DB
 * instead of fetching from OpenRouter.
 *
 * Returns an OpenAI-compatible /models response so opencode
 * can populate its model picker.
 */
import { db } from '../../shared/db';
import { platformModels } from '@kortix/db';
import { eq } from 'drizzle-orm';

export async function listUpstreamModels(): Promise<Response> {
  try {
    const models = await db
      .select({
        modelKey: platformModels.modelKey,
        displayName: platformModels.displayName,
        upstreamModelId: platformModels.upstreamModelId,
        isActive: platformModels.isActive,
        isDefault: platformModels.isDefault,
      })
      .from(platformModels)
      .where(eq(platformModels.isActive, true));

    // OpenAI-compatible format
    const data = models.map((m) => ({
      id: m.upstreamModelId || m.modelKey,
      name: m.displayName,
      object: 'model' as const,
      created: 0,
      owned_by: 'vaelorx',
    }));

    return new Response(JSON.stringify({ object: 'list', data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('[upstream-models] Failed to list models:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch models' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
}
