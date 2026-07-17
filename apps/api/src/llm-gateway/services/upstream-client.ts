/**
 * Upstream Client — Multi-Provider LLM Gateway with automatic failover
 *
 * Reads the default model from the DB (platform_models) and finds ALL
 * providers that can serve it. Calls the primary (is_default) provider
 * first; on timeout or error, automatically falls back to the next
 * available provider.
 *
 * Security: The real API key NEVER leaves the API server. The sandbox
 * only sees a sandbox token (kortix_sb_...) which authenticates against
 * /v1/llm — this module does the actual upstream call with the real key.
 */
import { db } from '../../shared/db';
import { platformModels, platformProviders } from '@kortix/db';
import { eq, or } from 'drizzle-orm';

interface ResolvedProvider {
  modelKey: string;
  displayName: string;
  providerKey: string;
  apiKey: string;
  baseUrl: string;
  isPrimary: boolean;
}

/**
 * Resolve the default model + ALL providers that can serve it.
 * Returns {primary, fallbacks[]}.
 */
export async function resolveDefaultProvider(): Promise<{
  primary: ResolvedProvider | null;
  fallbacks: ResolvedProvider[];
}> {
  try {
    const [defaultModel] = await db
      .select({
        modelKey: platformModels.modelKey,
        upstreamModelId: platformModels.upstreamModelId,
        displayName: platformModels.displayName,
        provider: platformModels.provider,
      })
      .from(platformModels)
      .where(eq(platformModels.isDefault, true))
      .limit(1);

    if (!defaultModel) {
      console.warn('[upstream-client] No default model found in DB');
      return { primary: null, fallbacks: [] };
    }

    const primaryModelId = defaultModel.upstreamModelId || defaultModel.modelKey;
    const bareModelId = primaryModelId.includes('/')
      ? primaryModelId.split('/').pop()!
      : primaryModelId;

    // Find ALL active models that match by bare id
    const matchingModels = await db
      .select({
        modelKey: platformModels.modelKey,
        upstreamModelId: platformModels.upstreamModelId,
        displayName: platformModels.displayName,
        provider: platformModels.provider,
        isDefault: platformModels.isDefault,
      })
      .from(platformModels)
      .where(
        or(
          eq(platformModels.modelKey, defaultModel.modelKey),
          eq(platformModels.modelKey, primaryModelId),
          eq(platformModels.modelKey, bareModelId),
          eq(platformModels.upstreamModelId, primaryModelId),
          eq(platformModels.upstreamModelId, bareModelId),
        ),
      );

    if (matchingModels.length === 0) {
      return { primary: null, fallbacks: [] };
    }

    const providerKeys = Array.from(new Set(matchingModels.map((m) => m.provider)));
    const providers = await db
      .select({
        providerKey: platformProviders.providerKey,
        apiKeyEnc: platformProviders.apiKeyEnc,
        baseUrl: platformProviders.baseUrl,
        isActive: platformProviders.isActive,
      })
      .from(platformProviders);

    const providerByKey = new Map(
      providers
        .filter((p) => p.isActive && p.apiKeyEnc && p.baseUrl)
        .map((p) => [p.providerKey, p]),
    );

    const resolved: ResolvedProvider[] = [];
    for (const m of matchingModels) {
      const p = providerByKey.get(m.provider);
      if (!p || !p.apiKeyEnc || !p.baseUrl) continue;
      resolved.push({
        modelKey: m.upstreamModelId || m.modelKey,
        displayName: m.displayName,
        providerKey: m.provider,
        apiKey: p.apiKeyEnc,
        baseUrl: p.baseUrl,
        isPrimary: m.isDefault === true,
      });
    }

    resolved.sort((a, b) => {
      if (a.isPrimary && !b.isPrimary) return -1;
      if (!a.isPrimary && b.isPrimary) return 1;
      return a.providerKey.localeCompare(b.providerKey);
    });

    const primary = resolved[0] ?? null;
    const fallbacks = resolved.slice(1);

    if (fallbacks.length > 0) {
      console.info(
        `[upstream-client] Default model "${primaryModelId}" has ${resolved.length} providers: ` +
        `${resolved.map((r) => `${r.providerKey}/${r.modelKey}${r.isPrimary ? '*' : ''}`).join(', ')}`,
      );
    } else {
      console.info(
        `[upstream-client] Default model "${primaryModelId}" has only 1 provider: ${primary?.providerKey ?? '?'}`,
      );
    }

    return { primary, fallbacks };
  } catch (err) {
    console.error('[upstream-client] Failed to resolve default provider:', err);
    return { primary: null, fallbacks: [] };
  }
}

function buildAuthHeaders(providerKey: string, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (providerKey === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['authorization'] = `Bearer ${apiKey}`;
  }
  return headers;
}

async function tryProvider(
  provider: ResolvedProvider,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<Response | null> {
  const upstreamBody = {
    ...body,
    model: provider.modelKey,
    stream: true,
    stream_options: { include_usage: true },
  };

  const headers = buildAuthHeaders(provider.providerKey, provider.apiKey);

  console.info(
    `[upstream-client] Calling provider: ${provider.providerKey} ` +
    `baseUrl=${provider.baseUrl} model=${provider.modelKey} ` +
    `apiKey=${provider.apiKey.slice(0, 10)}... stream=forced`,
  );

  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.status >= 500 || response.status === 429) {
      const text = await response.text().catch(() => '');
      console.warn(
        `[upstream-client] Provider ${provider.providerKey} returned ${response.status}: ${text.slice(0, 200)}`,
      );
      return null;
    }
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('abort');
    console.warn(
      `[upstream-client] Provider ${provider.providerKey} ${provider.modelKey} ` +
      `${isTimeout ? 'TIMED OUT' : 'failed'} after ${timeoutMs}ms: ${msg}`,
    );
    return null;
  }
}

function errorResponse(message: string, providerKey?: string, modelKey?: string): Response {
  return new Response(
    JSON.stringify({
      error: message,
      provider: providerKey,
      model: modelKey,
    }),
    { status: 502, headers: { 'content-type': 'application/json' } },
  );
}

/**
 * Call the upstream provider's chat/completions endpoint with automatic
 * failover across all providers that serve the default model.
 */
export async function callUpstream(
  body: Record<string, unknown>,
): Promise<{ response: Response; provider: ResolvedProvider | null }> {
  const { primary, fallbacks } = await resolveDefaultProvider();

  if (!primary) {
    return {
      response: errorResponse(
        'No default model/provider configured. Set one in Admin → LLM Providers.',
      ),
      provider: null,
    };
  }

  const PER_PROVIDER_TIMEOUT = 35_000;
  let response = await tryProvider(primary, body, PER_PROVIDER_TIMEOUT);
  if (response) {
    return { response, provider: primary };
  }

  console.warn(
    `[upstream-client] Primary provider "${primary.providerKey}" failed; ` +
    `trying ${fallbacks.length} fallback(s)...`,
  );

  for (const fallback of fallbacks) {
    response = await tryProvider(fallback, body, PER_PROVIDER_TIMEOUT);
    if (response) {
      console.info(
        `[upstream-client] Fallback to "${fallback.providerKey}/${fallback.modelKey}" SUCCEEDED`,
      );
      return { response, provider: fallback };
    }
  }

  const allProviders = [primary, ...fallbacks].map((p) => `${p.providerKey}/${p.modelKey}`).join(', ');
  return {
    response: errorResponse(
      `All providers timed out or errored for model "${primary.displayName}". ` +
      `Tried: ${allProviders}.`,
      primary.providerKey,
      primary.modelKey,
    ),
    provider: primary,
  };
}
