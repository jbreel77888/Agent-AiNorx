/**
 * Notifications API — list, mark-read, SSE stream.
 *
 * Reuses the tunnel SSE pattern (in-memory subscriber map + keep-alive).
 * Notifications are stored in kortix.notifications table.
 *
 * Internal `notify()` helper can be called from anywhere in the API
 * to create + broadcast a notification.
 */
import { Hono } from 'hono';
import { eq, desc, and, isNull, sql } from 'drizzle-orm';
import { db } from '../shared/db';
import { supabaseAuth } from '../middleware/auth';
import { logger } from '../lib/logger';

// ─── SSE infrastructure (copied from tunnel/routes/permission-requests.ts) ──

type SSEWriter = (data: unknown) => void;
const sseSubscribers = new Map<string, Set<SSEWriter>>(); // keyed by accountId

function broadcastNotification(accountId: string, notification: unknown): void {
  const subscribers = sseSubscribers.get(accountId);
  if (!subscribers || subscribers.size === 0) return;
  for (const writer of subscribers) {
    try { writer(notification); } catch {}
  }
}

// ─── Internal helper: create + broadcast ────────────────────────────────────

export async function notify(opts: {
  accountId: string;
  userId?: string | null;
  kind: string;
  title: string;
  body?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    const result = await db.execute(sql`
      INSERT INTO kortix.notifications (account_id, user_id, kind, title, body, payload)
      VALUES (${opts.accountId}, ${opts.userId ?? null}, ${opts.kind}, ${opts.title}, ${opts.body ?? null}, ${JSON.stringify(opts.payload ?? {})}::jsonb)
      RETURNING notification_id, account_id, user_id, kind, title, body, payload, read_at, created_at
    `);

    const rows = result.rows ?? result;
    const notification = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (notification) {
      broadcastNotification(opts.accountId, notification);
    }
  } catch (err) {
    logger.error('[notifications] failed to create notification', { error: err instanceof Error ? err.message : String(err) });
  }
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export const notificationsApp = new Hono<{ Variables: { userId: string; accountId: string } }>();

notificationsApp.use('*', supabaseAuth);

// GET /v1/notifications — list (filter by unread, paginate)
notificationsApp.get('/', async (c) => {
  const userId = c.get('userId') as string;
  const unreadOnly = c.req.query('unread') === 'true';
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');

  // Resolve accountId from user
  const { resolveAccountId } = await import('../shared/resolve-account');
  const accountId = await resolveAccountId(userId);
  if (!accountId) return c.json({ error: 'Account not found' }, 400);

  const whereClause = unreadOnly
    ? sql`account_id = ${accountId} AND read_at IS NULL`
    : sql`account_id = ${accountId}`;

  const result = await db.execute(sql`
    SELECT notification_id, account_id, user_id, kind, title, body, payload, read_at, created_at
    FROM kortix.notifications
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const rows = result.rows ?? result;
  const items = Array.isArray(rows) ? rows : [];

  // Count unread
  const unreadResult = await db.execute(sql`
    SELECT COUNT(*) as count FROM kortix.notifications
    WHERE account_id = ${accountId} AND read_at IS NULL
  `);
  const unreadCount = (unreadResult.rows ?? unreadResult)[0]?.count ?? 0;

  return c.json({ notifications: items, unreadCount: Number(unreadCount) });
});

// POST /v1/notifications/:id/read — mark one as read
notificationsApp.post('/:id/read', async (c) => {
  const id = c.req.param('id');
  await db.execute(sql`
    UPDATE kortix.notifications SET read_at = NOW()
    WHERE notification_id = ${id}
  `);
  return c.json({ ok: true });
});

// POST /v1/notifications/read-all — mark all as read
notificationsApp.post('/read-all', async (c) => {
  const userId = c.get('userId') as string;
  const { resolveAccountId } = await import('../shared/resolve-account');
  const accountId = await resolveAccountId(userId);
  if (!accountId) return c.json({ error: 'Account not found' }, 400);

  await db.execute(sql`
    UPDATE kortix.notifications SET read_at = NOW()
    WHERE account_id = ${accountId} AND read_at IS NULL
  `);
  return c.json({ ok: true });
});

// GET /v1/notifications/stream — SSE stream
notificationsApp.get('/stream', async (c) => {
  const userId = c.get('userId') as string;
  const { resolveAccountId } = await import('../shared/resolve-account');
  const accountId = await resolveAccountId(userId);
  if (!accountId) return c.json({ error: 'Account not found' }, 400);

  return new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const writer: SSEWriter = (data) => {
          const payload = `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        };

        // Register subscriber
        if (!sseSubscribers.has(accountId)) {
          sseSubscribers.set(accountId, new Set());
        }
        sseSubscribers.get(accountId)!.add(writer);

        // Send initial connection event
        writer({ type: 'connected', timestamp: Date.now() });

        // Keep-alive every 30s
        const keepAlive = setInterval(() => {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        }, 30_000);

        // Cleanup on disconnect
        c.req.raw.signal.addEventListener('abort', () => {
          clearInterval(keepAlive);
          sseSubscribers.get(accountId)?.delete(writer);
          try { controller.close(); } catch {}
        });
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    },
  );
});
