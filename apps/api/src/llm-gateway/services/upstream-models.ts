/**
 * Upstream Models — returns the model catalog from the DB with accurate
 * context limits and capabilities for each model.
 */
import { db } from '../../shared/db';
import { platformModels } from '@kortix/db';
import { eq } from 'drizzle-orm';

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

  // DeepSeek (OpenCode Zen reports 1M context for v4-flash-free)
  'deepseek-v4-flash': { context_length: 1_000_000, output: 64_000, reasoning: true, tool_call: true, attachment: true, temperature: true },
  'deepseek-v4-flash-free': { context_length: 1_000_000, output: 64_000, reasoning: true, tool_call: true, attachment: true, temperature: true },
  'deepseek-v4-pro': { context_length: 1_000_000, output: 64_000, reasoning: true, tool_call: true, attachment: true, temperature: true },

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

const DEFAULT_LIMITS: ModelSpec = { context_length: 128_000, output: 8_000 };

function lookupModelLimits(modelId: string): ModelSpec {
  if (!modelId) return DEFAULT_LIMITS;
  if (MODEL_CATALOG[modelId]) return MODEL_CATALOG[modelId];
  const bareId = modelId.includes('/') ? modelId.split('/').pop()! : modelId;
  if (MODEL_CATALOG[bareId]) return MODEL_CATALOG[bareId];
  const withoutUs = bareId.replace(/^us\./, '');
  if (MODEL_CATALOG[withoutUs]) return MODEL_CATALOG[withoutUs];
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
        metadata: platformModels.metadata,
      })
      .from(platformModels)
      .where(eq(platformModels.isActive, true));

    const data = models.map((m) => {
      const id = m.upstreamModelId || m.modelKey;
      // PRIORITY: provider-reported limits (from refresh-models, stored in
      // metadata.context_length) take precedence over MODEL_CATALOG
      // (hardcoded guesses). This ensures the UI shows REAL limits that
      // the provider actually enforces, not our approximations.
      const meta = (m.metadata as Record<string, unknown>) ?? {};
      const providerContextLength =
        typeof meta.context_length === 'number' ? meta.context_length :
        typeof meta.context_window === 'number' ? meta.context_window : undefined;
      const providerMaxTokens =
        typeof meta.max_tokens === 'number' ? meta.max_tokens :
        typeof meta.output_tokens === 'number' ? meta.output_tokens : undefined;

      // Fall back to MODEL_CATALOG only if the provider didn't report limits
      const catalogLimits = lookupModelLimits(id);
      const contextLength = providerContextLength ?? catalogLimits.context_length;
      const maxTokens = providerMaxTokens ?? catalogLimits.output;

      return {
        id,
        name: m.displayName,
        object: 'model' as const,
        created: 0,
        owned_by: 'vaelorx',
        context_length: contextLength,
        max_tokens: maxTokens,
        reasoning: catalogLimits.reasoning ?? false,
        tool_call: catalogLimits.tool_call ?? true,
        attachment: catalogLimits.attachment ?? true,
        temperature: catalogLimits.temperature ?? true,
        is_default: m.isDefault ?? false,
        // Source flag for debugging: 'provider' = real limits from provider's
        // /models endpoint, 'catalog' = our hardcoded guess, 'default' = fallback
        limit_source: providerContextLength ? 'provider' :
                      catalogLimits.context_length ? 'catalog' : 'default',
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
