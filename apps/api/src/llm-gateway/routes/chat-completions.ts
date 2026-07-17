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
  'z-ai/glm-5.2',
  'x-ai/grok-4.3',
]);

function supportsReasoning(model: string): boolean {
  if (!model) return false;
  if (REASONING_CAPABLE_MODELS.has(model)) return true;
  const stripped = model.replace(/^openrouter\//, '');
  return REASONING_CAPABLE_MODELS.has(stripped);
}

/**
 * Aggregate an OpenAI-style SSE chat-completion stream into a single JSON
 * chat-completion object. Used when the caller asked for stream:false but
 * we forced stream:true on the upstream call (to avoid Gateway Timeout on
 * slow reasoning models).
 *
 * SSE format (one event per line, terminated by \n\n):
 *   data: {"id":"...","choices":[{"delta":{"content":"hello"}}],"usage":null}
 *   data: {"id":"...","choices":[{"delta":{"content":" world"}}],"usage":null}
 *   data: {"id":"...","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2}}
 *   data: [DONE]
 *
 * Output: a single object with merged content, total usage, and the last
 * finish_reason / role seen.
 */
function aggregateSseToJson(sseBuffer: string): Record<string, unknown> {
  const lines = sseBuffer.split('\n');
  let id = '';
  let model = '';
  let role = 'assistant';
  let content = '';
  let reasoning: string | undefined;
  let finishReason: string | null = null;
  let usage: Record<string, number> | null = null;
  const toolCalls: Array<Record<string, unknown>> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]' || payload === '') continue;
    try {
      const chunk: any = JSON.parse(payload);
      if (chunk.id) id = chunk.id;
      if (chunk.model) model = chunk.model;
      if (chunk.usage) usage = chunk.usage;
      const choices = chunk.choices;
      if (Array.isArray(choices)) {
        for (const choice of choices) {
          const delta = choice?.delta;
          if (delta?.role) role = delta.role;
          if (typeof delta?.content === 'string') content += delta.content;
          if (typeof delta?.reasoning === 'string') {
            reasoning = (reasoning ?? '') + delta.reasoning;
          }
          if (Array.isArray(delta?.tool_calls)) {
            for (const tcRaw of delta.tool_calls as any[]) {
              const tc: any = tcRaw ?? {};
              const idx = typeof tc.index === 'number' ? tc.index : 0;
              if (!toolCalls[idx]) {
                toolCalls[idx] = {
                  id: tc.id ?? '',
                  type: tc.type ?? 'function',
                  function: { name: '', arguments: '' },
                };
              }
              const slot = toolCalls[idx] as any;
              if (tc.function?.name) slot.function.name = tc.function.name;
              if (tc.function?.arguments) {
                slot.function.arguments =
                  (slot.function.arguments ?? '') + tc.function.arguments;
              }
            }
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason;
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  const message: Record<string, unknown> = { role, content };
  if (reasoning) message.reasoning = reasoning;
  const filteredToolCalls = toolCalls.filter((t) => t !== undefined);
  if (filteredToolCalls.length > 0) message.tool_calls = filteredToolCalls;

  return {
    id: id || `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model || 'unknown',
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason || 'stop',
      },
    ],
    usage: usage ?? {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
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
      // The upstream is always called with stream:true (see callUpstream in
      // upstream-client.ts — this avoids Cloudflare Gateway Timeout on
      // slow reasoning models). When the caller asked for non-streaming,
      // we aggregate the SSE stream into a single JSON completion object.
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) sseBuffer += decoder.decode(value, { stream: true });
        }
      } catch (err) {
        console.warn(`[llm-gateway] ${requestId} non-streaming read error:`, err);
        return c.json({ error: 'Upstream stream interrupted' }, 502);
      }

      // Parse the SSE buffer into a single chat completion object.
      // Each `data: {...}` line is a chunk with delta.content; we merge them.
      const aggregated = aggregateSseToJson(sseBuffer);
      const usage = extractUsageFromJson(aggregated);
      void finalize(usage, provider?.modelKey);
      return c.json(aggregated);
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
