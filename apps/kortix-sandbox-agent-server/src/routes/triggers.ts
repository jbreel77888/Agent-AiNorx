import { Hono } from 'hono';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { Config } from '../config';
import { logger } from '../logger';
import type { Opencode } from '../opencode';
import {
  KORTIX_USER_CONTEXT_HEADER,
  verifyKortixUserContext,
} from '../kortix-user-context';

/**
 * Triggers Router — /kortix/triggers
 *
 * CRUD for scheduled triggers stored in the sandbox filesystem.
 * Each trigger has a cron expression, an action (prompt/command),
 * and runtime state (last_fired_at, next_run_at, active).
 *
 * The triggers are stored in /workspace/.vaelorx/triggers.json
 * and executed by the API's cron scheduler (which calls the
 * daemon's /kortix/triggers/:id/run endpoint).
 */

interface Trigger {
  id: string;
  name: string;
  description?: string;
  source: {
    type: 'cron' | 'webhook';
    cron_expr?: string;
    timezone?: string;
    path?: string;
    method?: string;
    secret?: string;
  };
  action: {
    type: 'prompt' | 'command' | 'http';
    prompt?: string;
    agent?: string;
    model?: string;
    session_mode?: 'new' | 'reuse';
    command?: string;
    args?: string[];
    workdir?: string;
    timeout_ms?: number;
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body_template?: string;
  };
  context?: {
    extract?: boolean;
    include_raw?: boolean;
  };
  metadata?: Record<string, unknown>;
  enabled: boolean;
  last_run_at?: string;
  next_run_at?: string;
  created_at: string;
  updated_at: string;
}

interface Execution {
  execution_id: string;
  trigger_id: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'timeout';
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  result?: Record<string, unknown>;
  error?: string;
}

function triggersFilePath(cfg: Config): string {
  return join(cfg.projectTarget, '.vaelorx', 'triggers.json');
}

function loadTriggers(cfg: Config): Trigger[] {
  try {
    const path = triggersFilePath(cfg);
    if (!existsSync(path)) return [];
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveTriggers(cfg: Config, triggers: Trigger[]): void {
  const path = triggersFilePath(cfg);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(triggers, null, 2));
}

function loadExecutions(cfg: Config): Execution[] {
  try {
    const path = join(cfg.projectTarget, '.vaelorx', 'trigger-executions.json');
    if (!existsSync(path)) return [];
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(data) ? data.slice(-100) : []; // keep last 100
  } catch {
    return [];
  }
}

function saveExecutions(cfg: Config, executions: Execution[]): void {
  const path = join(cfg.projectTarget, '.vaelorx', 'trigger-executions.json');
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(executions.slice(-100), null, 2));
}

export function createTriggersRouter(cfg: Config, opencode: Opencode): Hono {
  const router = new Hono();

  // Auth gate
  router.use('*', async (c, next) => {
    if (!cfg.sandboxToken) {
      return c.json({ error: 'daemon not configured' }, 503);
    }
    const auth = verifyKortixUserContext(c.req.header(KORTIX_USER_CONTEXT_HEADER), cfg.sandboxToken);
    if (!auth.ok) {
      return c.json({ error: 'unauthorized', reason: auth.reason }, 401);
    }
    await next();
  });

  // List triggers
  router.get('/', async (c) => {
    const triggers = loadTriggers(cfg);
    return c.json({ success: true, data: triggers });
  });

  // Get one trigger
  router.get('/:triggerId', async (c) => {
    const triggers = loadTriggers(cfg);
    const trigger = triggers.find((t) => t.id === c.req.param('triggerId'));
    if (!trigger) return c.json({ error: 'Trigger not found' }, 404);
    return c.json({ success: true, data: trigger });
  });

  // Create trigger
  router.post('/', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const triggers = loadTriggers(cfg);

    const trigger: Trigger = {
      id: randomUUID(),
      name: body.name || 'Untitled Trigger',
      description: body.description,
      source: body.source || { type: 'cron', cron_expr: '*/5 * * * *' },
      action: body.action || { type: 'prompt', prompt: '' },
      context: body.context,
      metadata: body.metadata,
      enabled: body.enabled !== false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    triggers.push(trigger);
    saveTriggers(cfg, triggers);
    logger.info(`[triggers] Created trigger: ${trigger.id} (${trigger.name})`);
    return c.json({ success: true, data: trigger }, 201);
  });

  // Update trigger
  router.patch('/:triggerId', async (c) => {
    const triggerId = c.req.param('triggerId');
    const body = await c.req.json().catch(() => ({}));
    const triggers = loadTriggers(cfg);
    const idx = triggers.findIndex((t) => t.id === triggerId);
    if (idx === -1) return c.json({ error: 'Trigger not found' }, 404);

    triggers[idx] = {
      ...triggers[idx],
      ...body,
      id: triggerId, // prevent ID change
      updated_at: new Date().toISOString(),
    };
    saveTriggers(cfg, triggers);
    return c.json({ success: true, data: triggers[idx] });
  });

  // Delete trigger
  router.delete('/:triggerId', async (c) => {
    const triggerId = c.req.param('triggerId');
    const triggers = loadTriggers(cfg);
    const filtered = triggers.filter((t) => t.id !== triggerId);
    if (filtered.length === triggers.length) {
      return c.json({ error: 'Trigger not found' }, 404);
    }
    saveTriggers(cfg, filtered);
    return c.json({ success: true });
  });

  // Pause trigger
  router.post('/:triggerId/pause', async (c) => {
    const triggerId = c.req.param('triggerId');
    const triggers = loadTriggers(cfg);
    const idx = triggers.findIndex((t) => t.id === triggerId);
    if (idx === -1) return c.json({ error: 'Trigger not found' }, 404);
    const trigger = triggers[idx]!;
    trigger.enabled = false;
    trigger.updated_at = new Date().toISOString();
    saveTriggers(cfg, triggers);
    return c.json({ success: true, data: trigger });
  });

  // Resume trigger
  router.post('/:triggerId/resume', async (c) => {
    const triggerId = c.req.param('triggerId');
    const triggers = loadTriggers(cfg);
    const idx = triggers.findIndex((t) => t.id === triggerId);
    if (idx === -1) return c.json({ error: 'Trigger not found' }, 404);
    const trigger = triggers[idx]!;
    trigger.enabled = true;
    trigger.updated_at = new Date().toISOString();
    saveTriggers(cfg, triggers);
    return c.json({ success: true, data: triggers[idx] });
  });

  // Manual run
  router.post('/:triggerId/run', async (c) => {
    const triggerId = c.req.param('triggerId');
    const triggers = loadTriggers(cfg);
    const trigger = triggers.find((t) => t.id === triggerId);
    if (!trigger) return c.json({ error: 'Trigger not found' }, 404);

    const execution: Execution = {
      execution_id: randomUUID(),
      trigger_id: triggerId,
      status: 'running',
      started_at: new Date().toISOString(),
    };

    try {
      if (trigger.action.type === 'prompt') {
        // Send prompt to opencode
        const promptBody = {
          message: trigger.action.prompt || '',
          agent: trigger.action.agent,
          model: trigger.action.model,
        };
        const response = await fetch(
          `${opencode.getInternalUrl()}/session/${cfg.projectTarget.split('/').pop()}/prompt_async`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(promptBody),
          },
        ).catch((err) => {
          logger.error(`[triggers] Failed to send prompt: ${err}`);
          throw err;
        });

        execution.status = response.ok ? 'success' : 'failed';
        execution.result = { status: response.status };
      } else if (trigger.action.type === 'command') {
        // Execute shell command
        const { execSync } = await import('node:child_process');
        const output = execSync(trigger.action.command || 'echo', {
          cwd: trigger.action.workdir || cfg.projectTarget,
          timeout: trigger.action.timeout_ms || 30_000,
          encoding: 'utf8',
        });
        execution.status = 'success';
        execution.result = { stdout: output.slice(0, 1000) };
      } else {
        execution.status = 'failed';
        execution.error = `Unknown action type: ${trigger.action.type}`;
      }
    } catch (err) {
      execution.status = 'failed';
      execution.error = err instanceof Error ? err.message : String(err);
    }

    execution.completed_at = new Date().toISOString();
    execution.duration_ms = Date.now() - new Date(execution.started_at).getTime();

    // Save execution
    const executions = loadExecutions(cfg);
    executions.push(execution);
    saveExecutions(cfg, executions);

    // Update trigger last_run_at
    const idx = triggers.findIndex((t) => t.id === triggerId);
    if (idx !== -1) {
      const trigger = triggers[idx]!;
      trigger.last_run_at = execution.started_at;
      saveTriggers(cfg, triggers);
    }

    return c.json({
      success: true,
      data: {
        execution_id: execution.execution_id,
        status: execution.status,
        message: execution.status === 'success' ? 'Trigger executed successfully' : execution.error,
      },
    });
  });

  // List executions by trigger
  router.get('/executions/by-trigger/:triggerId', async (c) => {
    const triggerId = c.req.param('triggerId');
    const limit = parseInt(c.req.query('limit') || '20');
    const offset = parseInt(c.req.query('offset') || '0');
    const executions = loadExecutions(cfg)
      .filter((e) => e.trigger_id === triggerId)
      .slice(offset, offset + limit);
    return c.json({ success: true, data: executions });
  });

  return router;
}
