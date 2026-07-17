/**
 * Upstream Client — Multi-Provider LLM Gateway
 *
 * Replaces openrouter-client.ts. Instead of hardcoding OpenRouter,
 * reads the default model + provider from the DB (platform_models +
 * platform_providers) and calls the real provider directly.
 *
 * Security: The real API key NEVER leaves the API server. The sandbox
 * only sees a sandbox token (kortix_sb_...) which authenticates against
 * /v1/llm — this module does the actual upstream call with the real key.
 */
import { db } from '../../shared/db';
import { platformModels, platformProviders } from '@kortix/db';
import { eq } from 'drizzle-orm';

interface ResolvedProvider {
  modelKey: string;        // e.g. "claude-sonnet-4-6" (upstream ID)
  displayName: string;     // e.g. "Claude Sonnet 4.6"
  providerKey: string;     // e.g. "anthropic"
  apiKey: string;          // real API key from DB
  baseUrl: string;         // e.g. "https://api.anthropic.com/v1"
}

/**
 * Resolve the current default model + its provider from the DB.
 * Called on EVERY chat/completions request so admin changes take effect immediately.
 */
export async function resolveDefaultProvider(): Promise<ResolvedProvider | null> {
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
      return null;
    }

    // Use upstreamModelId if available (e.g. "claude-sonnet-4-6" instead of "anthropic/claude-sonnet-4.6")
    const modelKey = defaultModel.upstreamModelId || defaultModel.modelKey;

    // 2. Find the provider's credentials
    const [provider] = await db
      .select({
        apiKeyEnc: platformProviders.apiKeyEnc,
        baseUrl: platformProviders.baseUrl,
        isActive: platformProviders.isActive,
      })
      .from(platformProviders)
      .where(eq(platformProviders.providerKey, defaultModel.provider))
      .limit(1);

    if (!provider?.isActive || !provider.apiKeyEnc || !provider.baseUrl) {
      console.warn(`[upstream-client] Provider "${defaultModel.provider}" not active or missing key/baseUrl`);
      return null;
    }

    return {
      modelKey,
      displayName: defaultModel.displayName,
      providerKey: defaultModel.provider,
      apiKey: provider.apiKeyEnc,
      baseUrl: provider.baseUrl,
    };
  } catch (err) {
    console.error('[upstream-client] Failed to resolve default provider:', err);
    return null;
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
 * Call the upstream provider's chat/completions endpoint.
 * Passes through the body (with model replaced by the upstream model ID)
 * and returns the raw Response (JSON or SSE stream).
 *
 * The body.model field is replaced with the real upstream model ID
 * because the sandbox sends "vaelorx/<model>" but the provider expects
 * just the model ID (e.g. "claude-sonnet-4-6").
 *
 * IMPORTANT — Gateway Timeout mitigation:
 * Cloudflare / Bunnyshell's reverse proxy has a hard ~100s timeout on
 * idle connections. Reasoning models (especially NVIDIA's z-ai/glm-5.2
 * with reasoning effort) can take > 60s to produce the first byte on
 * non-streaming requests, which causes the proxy to return "Gateway
 * Timeout" to the client even though the upstream provider is still
 * processing.
 *
 * Mitigation:
 *   1. We force `stream: true` on the upstream call (the caller's
 *      `stream` preference is preserved in the response — see
 *      chat-completions.ts which already handles SSE → JSON conversion
 *      when the caller asked for non-streaming).
 *   2. We use a 110s timeout (just under Cloudflare's 100-120s limit)
 *      so we fail fast with a clear message instead of letting the
 *      proxy kill the connection silently.
 *   3. The first SSE chunk arrives within seconds for all known
 *      providers, so streaming keeps the connection alive.
 */
export async function callUpstream(
  body: Record<string, unknown>,
): Promise<{ response: Response; provider: ResolvedProvider | null }> {
  const provider = await resolveDefaultProvider();

  if (!provider) {
    // Fallback: return a 502 so the caller can surface the error
    return {
      response: new Response(
        JSON.stringify({ error: 'No default model/provider configured. Set one in Admin → LLM Providers.' }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      ),
      provider: null,
    };
  }

  // Replace the model in the body with the upstream model ID
  const upstreamBody = {
    ...body,
    model: provider.modelKey,
    // Force streaming to keep the connection alive — see comment above.
    // chat-completions.ts already converts the SSE stream back to a single
    // JSON response when the original caller asked for non-streaming.
    stream: true,
    stream_options: { include_usage: true },
  };

  const headers = buildAuthHeaders(provider.providerKey, provider.apiKey);
  // Some providers (NVIDIA) reject unknown OpenAI-specific fields like
  // `stream_options`. We don't strip them here — they're standard OpenAI
  // and NVIDIA's OpenAI-compatible endpoint accepts them.

  console.info(
    `[upstream-client] Calling provider: ${provider.providerKey} ` +
    `baseUrl=${provider.baseUrl} model=${provider.modelKey} ` +
    `apiKey=${provider.apiKey.slice(0, 10)}... stream=forced`,
  );

  let response: Response;
  try {
    response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(upstreamBody),
      // 110s — just under Cloudflare/Bunnyshell's ~100-120s idle timeout.
      // Without this, a slow upstream (e.g. NVIDIA reasoning on glm-5.2)
      // would silently get killed by the reverse proxy and the client
      // would see "Gateway Timeout" with no useful diagnostic.
      signal: AbortSignal.timeout(110_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('abort');
    console.error(
      `[upstream-client] fetch failed for ${provider.providerKey} ${provider.modelKey}: ${msg}`,
    );
    return {
      response: new Response(
        JSON.stringify({
          error: isTimeout
            ? `Upstream provider "${provider.providerKey}" timed out after 110s. ` +
              `This usually means the model "${provider.modelKey}" is a reasoning model ` +
              `that took too long to respond. Try a faster model or enable streaming on the client.`
            : `Upstream provider "${provider.providerKey}" call failed: ${msg}`,
          provider: provider.providerKey,
          model: provider.modelKey,
        }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      ),
      provider,
    };
  }

  return { response, provider };
}
