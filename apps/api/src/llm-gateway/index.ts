import { createChatCompletionsRoute } from './routes/chat-completions';
import { createModelsRoute } from './routes/models';
import { createHealthRoute } from './routes/health';
import type { LlmGatewayConfig, LlmGatewayHooks } from './types';
import type { AppEnv } from '../types';
import { makeOpenApiApp } from '../openapi';

export type { LlmGatewayConfig, LlmGatewayHooks } from './types';

export function createLlmGateway(
  config: LlmGatewayConfig,
  hooks: LlmGatewayHooks,
) {
  const app = makeOpenApiApp<AppEnv>();

  if (!config.enabled) {
    app.all('/*', (c) => c.json({ error: 'LLM gateway is disabled' }, 503));
    return app;
  }

  // No longer require openrouterApiKey — the gateway reads provider keys from DB.
  // The openrouterApiKey field is kept in the config type for backward compat
  // but is no longer used.

  app.route('/', createHealthRoute(config));
  app.route('/', createModelsRoute(config));
  app.route('/', createChatCompletionsRoute(config, hooks));

  return app;
}
