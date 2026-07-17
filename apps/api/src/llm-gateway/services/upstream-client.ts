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
  modelKey: string;        // e.g. "z-ai/glm-5.2" or "glm-5.2" (per-provider upstream id)
  displayName: string;     // e.g. "GLM 5.2"
  providerKey: string;     // e.g. "nvidia" or "opencode"
  apiKey: string;          // real API key from DB
  baseUrl: string;         // e.g. "https://integrate.api.nvidia.com/v1"
  isPrimary: boolean;      // true if this is the admin-configured default
}

/**
 * Resolve the default model + ALL providers that can serve it.
 *
 * Strategy:
 *   1. Find the admin-configured default model (is_default=true).
 *   2. Find its modelKey / upstreamModelId.
 *   3. Find ALL active platform_models entries that match the SAME
 *      "logical" model (by modelKey OR upstreamModelId OR a normalized
 *      form with the provider prefix stripped — e.g. "z-ai/glm-5.2"
 *      and "glm-5.2" both refer to GLM 5.2).
 *   4. For each matching model row, look up its provider's credentials.
 *   5. Return the primary first, then fallbacks in priority order.
 *
 * This means: if the admin sets default to "z-ai/glm-5.2" from NVIDIA
 * and NVIDIA times out (86s+ on reasoning), the gateway automatically
 * retries on OpenCode Zen's "glm-5.2" without the user/admin needing
 * to do anything.
 */
export async function resolveDefaultProvider(): Promise<{
  primary: ResolvedProvider | null;
  fallbacks: ResolvedProvider[];
}> {
  try {
    // 1. Find the default model
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

    // 2. Normalize the model id — strip provider prefix for matching.
    //    "z-ai/glm-5.2" → "glm-5.2" so we can find "glm-5.2" on Zen too.
    const primaryModelId = defaultModel.upstreamModelId || defaultModel.modelKey;
    const bareModelId = primaryModelId.includes('/')
      ? primaryModelId.split('/').pop()!
      : primaryModelId;

    // 3. Find ALL active models that match (by exact modelKey, exact
    //    upstreamModelId, or the bare id without prefix). This is how we
    //    discover that "glm-5.2" on Zen is the same logical model as
    //    "z-ai/glm-5.2" on NVIDIA.
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
      // Shouldn't happen since the default itself matches, but guard anyway
      return { primary: null, fallbacks: [] };
    }

    // 4. Collect the unique set of providers we need credentials for.
    //    Multiple model rows may point to the same provider — dedupe.
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

    // 5. Build the resolved list — primary first, then fallbacks.
    //    Order: is_default=true first, then others alphabetically.
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

    // Sort: primary first, then by provider name for deterministic order
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

/**
 * Build the correct auth headers for each provider.
 * Most providers use `Authorization: Bearer <key>`,
 * but Anthropic uses `x-api-key` + `anthropic-version`.
 */
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

/**
 * Try a single provider. Returns the Response on success, or null on
 * recoverable error (timeout, 5xx, network) so the caller can fall back.
 * Throws only on truly unrecoverable errors (programming bug).
 */
async function tryProvider(
  provider: ResolvedProvider,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<Response | null> {
  const upstreamBody = {
    ...body,
    model: provider.modelKey,
    // Force streaming to keep the connection alive through reverse
    // proxies (Cloudflare, Bunnyshell) which have ~100s idle timeouts.
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

    // 5xx and 429 are recoverable — try the next provider
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

/**
 * Build an error Response with diagnostic info.
 */
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
 *
 * Flow:
 *   1. Resolve primary + fallback providers from DB.
 *   2. Try primary with a 35s timeout — short enough that a slow
 *      reasoning model (e.g. NVIDIA's z-ai/glm-5.2 takes ~86s) fails
 *      fast and we can fall back to a faster provider.
 *   3. On timeout or 5xx, try each fallback with the same 35s timeout.
 *   4. If all providers fail, return a clear 502 with diagnostic info.
 *
 * The body.model field is replaced with each provider's upstream model
 * ID (e.g. NVIDIA uses "z-ai/glm-5.2" but Zen uses "glm-5.2").
 *
 * IMPORTANT — Gateway Timeout mitigation:
 * Cloudflare / Bunnyshell's reverse proxy has a hard ~100s timeout on
 * idle connections. We force `stream: true` on every upstream call so
 * the first SSE chunk (which arrives within seconds for fast providers)
 * keeps the connection alive. chat-completions.ts aggregates the SSE
 * stream back into a single JSON object when the caller asked for
 * non-streaming.
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

  // 35s per-provider timeout — short enough to fail fast on slow
  // reasoning models (NVIDIA glm-5.2 takes 86s+) and try a fallback,
  // but long enough for normal reasoning (Claude, GPT, etc. which
  // typically respond in 2-15s).
  const PER_PROVIDER_TIMEOUT = 35_000;

  // Try the primary first
  let response = await tryProvider(primary, body, PER_PROVIDER_TIMEOUT);
  if (response) {
    return { response, provider: primary };
  }

  // Primary failed — try each fallback
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

  // All providers failed
  const allProviders = [primary, ...fallbacks].map((p) => `${p.providerKey}/${p.modelKey}`).join(', ');
  return {
    response: errorResponse(
      `All providers timed out or errored for model "${primary.displayName}". ` +
      `Tried: ${allProviders}. ` +
      `This usually means the model is a slow reasoning model on every configured provider. ` +
      `Try a faster model, or add another provider that serves this model.`,
      primary.providerKey,
      primary.modelKey,
    ),
    provider: primary,
  };
}
