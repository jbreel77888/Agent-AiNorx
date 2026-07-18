import { createRoute, z } from '@hono/zod-openapi';
import type { LlmGatewayConfig } from '../types';
import type { AppEnv } from '../../types';
import { listUpstreamModels } from '../services/upstream-models';
import { makeOpenApiApp, json, errors } from '../../openapi';

export function createModelsRoute(_config: LlmGatewayConfig) {
  const app = makeOpenApiApp<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/models',
      tags: ['llm'],
      summary: 'List available models (from DB — admin-configured)',
      responses: {
        200: json(
          z.object({ data: z.array(z.any()).optional() }).passthrough(),
          'OpenAI-compatible models list from platform_models DB table',
        ),
        ...errors(500),
      },
    }),
    async (c) => {
      const response = await listUpstreamModels();
      const data = await response.json();
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }) as any;
    },
  );

  // Lightweight endpoint that returns ONLY the current default model.
  // Used by the frontend to display the admin's current choice in the UI
  // (overriding any stale localStorage selection from a previous session).
  // Also used by the daemon at boot to write the correct model into
  // vaelorx.toml / opencode.jsonc / vaelorx.md.
  app.openapi(
    createRoute({
      method: 'get',
      path: '/models/default',
      tags: ['llm'],
      summary: 'Get the current default model (admin-configured)',
      responses: {
        200: json(
          z.object({
            id: z.string(),
            name: z.string().optional(),
            provider: z.string().optional(),
            context_length: z.number().optional(),
            reasoning: z.boolean().optional(),
          }),
          'The admin-configured default model',
        ),
        ...errors(404, 500),
      },
    }),
    async (c) => {
      const response = await listUpstreamModels();
      const data = (await response.json()) as {
        data?: Array<Record<string, unknown>>;
      };
      const defaultEntry = Array.isArray(data.data)
        ? data.data.find((m) => m?.is_default === true)
        : undefined;
      if (!defaultEntry?.id) {
        return c.json({ error: 'No default model configured' }, 404);
      }
      return c.json({
        id: defaultEntry.id,
        name: typeof defaultEntry.name === 'string' ? defaultEntry.name : defaultEntry.id,
        provider: typeof defaultEntry.owned_by === 'string' ? defaultEntry.owned_by : 'vaelorx',
        context_length: typeof defaultEntry.context_length === 'number' ? defaultEntry.context_length : undefined,
        reasoning: typeof defaultEntry.reasoning === 'boolean' ? defaultEntry.reasoning : undefined,
      });
    },
  );

  return app;
}
