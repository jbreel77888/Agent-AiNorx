'use client';

/**
 * Account-scoped Notifications Bell.
 *
 * Shows a bell icon with an unread count pill. Click → popover with the
 * latest 8 notifications. Mark all read / mark individual read. Auto-
 * refreshes every 30s and on window focus.
 *
 * Backed by /v1/notifications (account-scoped, session-only mode). Does
 * NOT use the legacy ticket-based notifications — this is the account-
 * scoped surface that ships with the session-only-mode platform.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, AlertCircle, CheckCircle2, Info, Inbox } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { backendApi } from '@/lib/api-client';
import { getSupabaseAccessTokenWithRetry } from '@/lib/auth-token';

interface AccountNotification {
  notification_id: string;
  account_id: string;
  user_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

interface NotificationsResponse {
  notifications: AccountNotification[];
  unreadCount: number;
}

const NOTIFICATIONS_KEY = ['account-notifications'] as const;

interface AuthedHeaders {
  Authorization: string;
}

async function authHeaders(): Promise<AuthedHeaders> {
  const token = await getSupabaseAccessTokenWithRetry();
  return { Authorization: `Bearer ${token}` };
}

async function authedFetch<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<T> {
  const headers = await authHeaders();
  if (options.method === 'POST') {
    const res = await backendApi.post<T>(`/notifications${path}`, options.body, {
      headers,
    });
    return res as unknown as T;
  }
  const res = await backendApi.get<T>(`/notifications${path}`, { headers });
  return res as unknown as T;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function kindIcon(kind: string) {
  if (kind.includes('error') || kind.includes('fail')) {
    return <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />;
  }
  if (
    kind.includes('session') ||
    kind.includes('task') ||
    kind.includes('complete')
  ) {
    return <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />;
  }
  if (kind.includes('trigger') || kind.includes('platform')) {
    return <Info className="h-4 w-4 text-blue-500 flex-shrink-0" />;
  }
  return <Bell className="h-4 w-4 text-muted-foreground flex-shrink-0" />;
}

export function AccountNotificationsBell({
  className,
}: {
  className?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data } = useQuery<NotificationsResponse>({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => authedFetch<NotificationsResponse>('', { method: 'GET' }),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const markAllRead = useMutation({
    mutationFn: () => authedFetch('/read-all', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    },
  });

  const markRead = useMutation({
    mutationFn: (id: string) =>
      authedFetch(`/${id}/read`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    },
  });

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;
  const preview = notifications.slice(0, 8);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'relative h-7 w-7 p-0 text-muted-foreground/60 hover:text-foreground',
            className,
          )}
          aria-label={
            unreadCount > 0
              ? `${unreadCount} unread notifications`
              : 'Notifications'
          }
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-[3px] inline-flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[9px] font-semibold leading-none tabular-nums ring-2 ring-background">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[360px] max-h-[460px] p-0"
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-medium">
            Notifications
            {unreadCount > 0 && (
              <span className="ml-2 text-xs text-muted-foreground">
                {unreadCount} unread
              </span>
            )}
          </p>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              <CheckCheck className="mr-1 h-3 w-3" />
              Mark all read
            </Button>
          )}
        </div>

        <div className="max-h-[380px] overflow-y-auto">
          {preview.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <Inbox className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">All caught up</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/60">
                Mentions and platform events will appear here
              </p>
            </div>
          ) : (
            preview.map((n) => (
              <button
                key={n.notification_id}
                type="button"
                onClick={() => {
                  if (!n.read_at) markRead.mutate(n.notification_id);
                  const target = (n.payload as { href?: string } | null)?.href;
                  if (target) {
                    router.push(target);
                    setOpen(false);
                  }
                }}
                className={cn(
                  'flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left transition-colors hover:bg-accent',
                  !n.read_at && 'bg-primary/5',
                )}
              >
                <div className="mt-0.5">{kindIcon(n.kind)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12.5px] font-medium truncate">
                      {n.title}
                    </p>
                    <span className="text-[10px] text-muted-foreground/70 flex-shrink-0">
                      {timeAgo(n.created_at)}
                    </span>
                  </div>
                  {n.body && (
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground line-clamp-2">
                      {n.body}
                    </p>
                  )}
                </div>
                {!n.read_at && (
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
                )}
              </button>
            ))
          )}
        </div>

        {notifications.length > 0 && (
          <button
            type="button"
            onClick={() => {
              router.push('/sessions/notifications');
              setOpen(false);
            }}
            className="block w-full border-t px-3 py-2 text-center text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            View all notifications
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
