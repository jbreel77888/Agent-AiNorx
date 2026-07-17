import { createRoute, z } from '@hono/zod-openapi';
import type { LlmGatewayConfig, LlmGatewayHooks, UsageEvent } from '../types';
import type { AppEnv } from '../../types';
import { callUpstream } from '../services/upstream-client';
import { calculateCost } from '../services/pricing';
import { extractUsageFromJson, extractUsageFromSseBuffer, type ExtractedUsage } from '../services/usage-extractor';
import { makeOpenApiApp, errors } from '../../openapi';

function newRequestId(): string {
  return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

const REASONING_CAPABLE_MODELS = new Set<string>([
  'anthropic/claude-opus-4.8',
  'anthropic/claude-sonnet-4.6',
  'openai/gpt-5.5',
  'google/gemini-3.5-flash',
  'google/gemini-3.1-pro-preview',
  'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v4-pro',
  'minimax/minimax-m3',
  'moonshotai/kimi-k2.6',
  'z-ai/glm-5.1',
  'x-ai/grok-4.3',
]);

function supportsReasoning(model: string): boolean {
  if (!model) return false;
  if (REASONING_CAPABLE_MODELS.has(model)) return true;
  const stripped = model.replace(/^openrouter\//, '');
  return REASONING_CAPABLE_MODELS.has(stripped);
}

export function createChatCompletionsRoute(
  _config: LlmGatewayConfig,
  hooks: LlmGatewayHooks,
) {
  const app = makeOpenApiApp<AppEnv>();

  app.openapi(
    createRoute({
      method: 'post',
      path: '/chat/completions',
      tags: ['llm'],
      summary: 'OpenAI-compatible chat completions (multi-provider gateway)',
      description:
        'Accepts an OpenAI-compatible chat-completions body. The gateway reads the default model + provider from the DB, calls the real upstream provider directly, and meters usage. The sandbox never sees the real API key.',
      responses: {
        200: {
          description:
            'Chat completion. JSON completion object when stream=false, or a Server-Sent Events stream (text/event-stream) when stream=true.',
          content: {
            'application/json': { schema: z.any() },
            'text/event-stream': { schema: z.string() },
          },
        },
        ...errors(400, 401, 402, 500, 502),
      },
    }),
    async (c) => {
    const requestId = newRequestId();
    const token = bearer(c.req.header('authorization'));

    if (!token) return c.json({ error: 'Missing bearer token' }, 401);
    const principal = await hooks.authenticateToken(token);
    if (!principal) return c.json({ error: 'Invalid token' }, 401);
    try {
      await hooks.assertBillingActive(principal.accountId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Billing inactive';
      return c.json(
        {
          error: message,
          message,
          code: 'subscription_required',
          account_id: principal.accountId,
        },
        402,
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const streaming = body.stream === true;

    const modelId = typeof body.model === 'string' ? body.model : '';
    const hasReasoning =
      body.reasoning !== undefined ||
      body.reasoning_effort !== undefined ||
      body.thinking !== undefined;
    if (!hasReasoning && supportsReasoning(modelId)) {
      body.reasoning = { effort: 'medium' };
    }

    // Call the upstream provider (reads model + provider + key from DB)
    const { response: upstream, provider } = await callUpstream(
      streaming ? { ...body, stream: true, stream_options: { include_usage: true } } : body,
    );

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      console.warn(`[llm-gateway] ${requestId} upstream error ${upstream.status}: ${text.slice(0, 200)}`);
      return c.json(
        { error: text || `Upstream provider error ${upstream.status}` },
        upstream.status as any,
      );
    }

    console.info(
      `[llm-gateway] ${requestId} provider=${provider?.providerKey ?? '?'} model=${provider?.modelKey ?? modelId} stream=${streaming} status=${upstream.status}`,
    );

    const finalize = async (usage: ExtractedUsage | null, modelHint?: string) => {
      if (!usage || usage.promptTokens + usage.completionTokens === 0) return;

      const model = (usage.model ?? modelHint ?? provider?.modelKey ?? 'unknown').toString();
      const { upstreamCost, finalCost } = calculateCost(
        model,
        {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          cachedTokens: usage.cachedTokens,
        },
        _config.markup ?? 1,
        usage.upstreamCostHint,
      );

      const event: UsageEvent = {
        accountId: principal.accountId,
        actorUserId: principal.userId,
        projectId: principal.projectId ?? null,
        sessionId: principal.sessionId ?? null,
        provider: provider?.providerKey ?? 'unknown',
        model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        cachedTokens: usage.cachedTokens,
        upstreamCost,
        finalCost,
        streaming,
        requestId,
      };
      try {
        await hooks.recordUsage(event);
      } catch (err) {
        console.warn(`[llm-gateway] recordUsage failed for ${requestId}:`, err);
      }
    };

    if (!streaming) {
      const json = await upstream.json();
      const usage = extractUsageFromJson(json);
      void finalize(usage, provider?.modelKey);
      return c.json(json);
    }

    const passthrough = new TransformStream<Uint8Array, Uint8Array>();
    const writer = passthrough.writable.getWriter();
    const decoder = new TextDecoder();
    let sseBuffer = '';

    (async () => {
      const reader = upstream.body!.getReader();
      let downstreamAlive = true;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            sseBuffer += decoder.decode(value, { stream: true });
            if (downstreamAlive) {
              try {
                await writer.write(value);
              } catch {
                downstreamAlive = false;
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[llm-gateway] stream read error ${requestId}:`, err);
      } finally {
        try {
          await writer.close();
        } catch {
        }
        const usage = extractUsageFromSseBuffer(sseBuffer);
        void finalize(usage, provider?.modelKey);
      }
    })().catch(() => {});

    return new Response(passthrough.readable, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    });
    },
  );

  return app;
}
