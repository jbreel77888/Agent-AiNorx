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
      // Use raw Response to avoid zod-openapi type constraints
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }) as any;
    },
  );

  return app;
}
