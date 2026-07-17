/**
 * Upstream Models — returns the model catalog from the DB
 * instead of fetching from OpenRouter.
 *
 * Returns an OpenAI-compatible /models response so opencode
 * can populate its model picker.
 *
 * IMPORTANT: Each model entry includes `context_length`, `reasoning`,
 * `tool_call`, `attachment`, and `temperature` fields so the daemon
 * can display accurate context limits and capabilities in the UI
 * without relying on its hardcoded MINIMAL_FALLBACK_MODELS table.
 */
import { db } from '../../shared/db';
import { platformModels } from '@kortix/db';
import { eq } from 'drizzle-orm';

/**
 * Known model limits and capabilities, indexed by bare model id
 * (the tail after the last "/"), so a model offered under any provider
 * prefix (e.g. "z-ai/glm-5.2" on NVIDIA or "glm-5.2" on Zen) resolves
 * to the same limits.
 *
 * Sources: official provider docs as of 2026-07. Update when providers
 * publish new limits.
 */
interface ModelSpec {
  context_length?: number;
  output?: number;
  reasoning?: boolean;
  tool_call?: boolean;
  attachment?: boolean;
  temperature?: boolean;
}

const MODEL_CATALOG: Record<string, ModelSpec> = {
  // Anthropic
  'claude-opus-4.8': { context_length: 1_000_000, output: 64_000, reasoning: true, tool_call: true, attachment: true, temperature: true },
  'claude-sonnet-4.6': { context_length: 1_000_000, output: 64_000, reasoning: true, tool_call: true, attachment: true, temperature: true },
  'claude-opus-4.7': { context_length: 500_000, output: 32_000, reasoning: true, tool_call: true, attachment: true, temperature: true },
  'claude-opus-4.6': { context_length: 500_000, output: 32_000, reasoning: true, tool_call: true, attachment: true, temperature: true },
  'claude-opus-4.5': { context_length: 500_000, output: 32_000, reasoning: true, tool_call: true, attachment: true, temperature: true },
  'claude-opus-4.1': { context_length: 500_000, output: 32_000, reasoning: true, tool_call: true, attachment: true, temperature: true },
  'claude-sonnet-5': { context_length: 500_000, output: 32_000, reasoning: true, tool_call: true, attachment: true, temperature: true },
  'claude-sonnet-4.5': { context_length: 500_000, output: 32_000, reasoning: true, tool_call: true, attachment: true, temperature: true },
  'claude-sonnet-4': { context_length: 500_000, output: 32_000, reasoning: true, tool_call: true, attachment: true, temperature: true },
  'claude-fable-5': { context_length: 500_000, output: 32_000, reasoning: true, tool_call: true, attachment: true, temperature: true },

  // OpenAI
  'gpt-5.5': { context_length: 1_050_000, output: 64_000, reasoning: true, tool_call: true, attachment: true, temperature: true },
  'gpt-5.1': { context_length: 1_050_000, output: 64_000, reasoning: true, tool_call: true, attachment: true, temperature: true },

  // Google
  'gemini-3.5-flash': { context_length: 1_048_576, output: 65_536, reasoning: true, tool_call: true, attachment: true, temperature: true },
  'gemini-3.1-pro-preview': { context_length: 1_048_576, output: 65_536, reasoning: true, tool_call: true, attachment: true, temperature: true },

  // DeepSeek
  'deepseek-v4-flash': { context_length: 128_000, output: 8_000, reasoning: true, tool_call: true, attachment: true, temperature: true },
  'deepseek-v4-flash-free': { context_length: 128_000, output: 8_000, reasoning: true, tool_call: true, attachment: true, temperature: true },
  'deepseek-v4-pro': { context_length: 128_000, output: 8_000, reasoning: true, tool_call: true, attachment: true, temperature: true },

  // MiniMax
  'minimax-m3': { context_length: 1_048_576, output: 64_000, reasoning: true, tool_call: true, attachment: true, temperature: true },
  'minimax-m2.7': { context_length: 1_048_576, output: 64_000, reasoning: true, tool_call: true, attachment: true, temperature: true },
  'minimax-m2.5': { context_length: 1_048_576, output: 64_000, reasoning: true, tool_call: true, attachment: true, temperature: true },

  // Moonshot
  'kimi-k2.6': { context_length: 262_144, output: 64_000, reasoning: true, tool_call: true, attachment: true, temperature: true },
  'kimi-k2.7-code': { context_length: 262_144, output: 64_000, reasoning: true, tool_call: true, attachment: true, temperature: true },

  // Z-AI (Zhipu)
  'glm-5.2': { context_length: 128_000, output: 16_000, reasoning: true, tool_call: true, attachment: true, temperature: true },
  'glm-5.1': { context_length: 128_000, output: 16_000, reasoning: true, tool_call: true, attachment: true, temperature: true },
  'glm-5': { context_length: 128_000, output: 16_000, reasoning: true, tool_call: true, attachment: true, temperature: true },

  // xAI
  'grok-4.3': { context_length: 1_000_000, output: 64_000, reasoning: true, tool_call: true, attachment: true, temperature: true },

  // Meta (non-reasoning)
  'llama-3.1-8b-instruct': { context_length: 128_000, output: 4_096, reasoning: false, tool_call: true, attachment: false, temperature: true },
  'llama-3.2-1b-instruct': { context_length: 128_000, output: 4_096, reasoning: false, tool_call: true, attachment: false, temperature: true },
  'llama-3.2-3b-instruct': { context_length: 128_000, output: 4_096, reasoning: false, tool_call: true, attachment: false, temperature: true },
  'llama-3.2-11b-vision-instruct': { context_length: 128_000, output: 4_096, reasoning: false, tool_call: true, attachment: true, temperature: true },
  'llama-3.2-90b-vision-instruct': { context_length: 128_000, output: 4_096, reasoning: false, tool_call: true, attachment: true, temperature: true },

  // IBM
  'granite-34b-code-instruct': { context_length: 8_000, output: 4_096, reasoning: false, tool_call: true, attachment: false, temperature: true },

  // NVIDIA
  'nemotron-3-embed-1b': { context_length: 8_192, output: 0, reasoning: false, tool_call: false, attachment: false, temperature: false },

  // Poolside
  'laguna-xs-2.1': { context_length: 32_768, output: 8_000, reasoning: false, tool_call: true, attachment: false, temperature: true },

  // Adept
  'fuyu-8b': { context_length: 16_384, output: 4_096, reasoning: false, tool_call: false, attachment: true, temperature: true },
};

/**
 * Conservative default for models not in the catalog.
 * Better to compact a little early than to never compact and get stuck.
 */
const DEFAULT_LIMITS: ModelSpec = { context_length: 128_000, output: 8_000 };

/**
 * Look up model limits by ID. Tries exact match first, then bare id
 * (without provider prefix). Falls back to DEFAULT_LIMITS.
 */
function lookupModelLimits(modelId: string): ModelSpec {
  if (!modelId) return DEFAULT_LIMITS;
  // Exact match
  if (MODEL_CATALOG[modelId]) return MODEL_CATALOG[modelId];
  // Bare id match (strip provider prefix: "z-ai/glm-5.2" → "glm-5.2")
  const bareId = modelId.includes('/') ? modelId.split('/').pop()! : modelId;
  if (MODEL_CATALOG[bareId]) return MODEL_CATALOG[bareId];
  // Try without "us." prefix (NVIDIA sometimes prefixes: "us.anthropic.claude-sonnet-4-6")
  const withoutUs = bareId.replace(/^us\./, '');
  if (MODEL_CATALOG[withoutUs]) return MODEL_CATALOG[withoutUs];
  // Try replacing dashes with dots in version numbers
  // "claude-sonnet-4-6" → "claude-sonnet-4.6"
  const dotted = bareId.replace(/-(\d+)$/, '.$1');
  if (MODEL_CATALOG[dotted]) return MODEL_CATALOG[dotted];
  return DEFAULT_LIMITS;
}

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

    // OpenAI-compatible format with extended fields for limits + capabilities.
    // The daemon reads these to populate OpenCode's model catalog with
    // accurate context windows, reasoning flags, and tool support —
    // without relying on its hardcoded MINIMAL_FALLBACK_MODELS table.
    const data = models.map((m) => {
      const id = m.upstreamModelId || m.modelKey;
      const limits = lookupModelLimits(id);
      return {
        id,
        name: m.displayName,
        object: 'model' as const,
        created: 0,
        owned_by: 'vaelorx',
        // Extended fields (OpenAI-compatible, extra fields are ignored by
        // clients that don't understand them):
        context_length: limits.context_length,
        max_tokens: limits.output,
        reasoning: limits.reasoning ?? false,
        tool_call: limits.tool_call ?? true,
        attachment: limits.attachment ?? true,
        temperature: limits.temperature ?? true,
        is_default: m.isDefault ?? false,
      };
    });

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
