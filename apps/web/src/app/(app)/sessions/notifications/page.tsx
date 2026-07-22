'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { backendApi } from '@/lib/api-client';
import { getSupabaseAccessTokenWithRetry } from '@/lib/auth-token';

interface Notification {
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

function kindIcon(kind: string) {
  if (kind.includes('session') || kind.includes('task')) return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (kind.includes('error') || kind.includes('fail')) return <AlertCircle className="h-4 w-4 text-red-500" />;
  return <Bell className="h-4 w-4 text-blue-500" />;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const token = await getSupabaseAccessTokenWithRetry();
      const res = await backendApi.get<{ notifications: Notification[]; unreadCount: number }>(
        '/notifications',
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.success) throw new Error(res.error?.message || 'Failed');
      return res.data;
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const token = await getSupabaseAccessTokenWithRetry();
      await backendApi.post('/notifications/read-all', {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const token = await getSupabaseAccessTokenWithRetry();
      await backendApi.post(`/notifications/${id}/read`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3 md:px-6 md:py-4">
        <div>
          <h1 className="text-lg font-semibold">Notifications</h1>
          <p className="text-muted-foreground text-sm">
            Task completion, platform updates, and session events
          </p>
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
          >
            Mark all read
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-3xl space-y-3">
          {isLoading ? (
            [1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))
          ) : notifications.length === 0 ? (
            <Card>
              <CardContent className="py-12">
                <div className="text-muted-foreground text-center">
                  <Bell className="mx-auto mb-3 h-10 w-10 opacity-40" />
                  <p className="text-sm">No notifications yet</p>
                  <p className="mt-1 text-xs">
                    You'll see session completions, trigger results, and platform updates here
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            notifications.map((n) => (
              <div
                key={n.notification_id}
                className={`flex items-start gap-3 rounded-lg border p-4 transition-colors ${
                  n.read_at ? 'opacity-60' : 'bg-primary/5'
                }`}
              >
                <div className="mt-0.5 flex-shrink-0">
                  {kindIcon(n.kind)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{n.title}</p>
                    {!n.read_at && (
                      <Badge variant="default" className="text-[10px]">New</Badge>
                    )}
                  </div>
                  {n.body && (
                    <p className="text-muted-foreground mt-0.5 text-xs">{n.body}</p>
                  )}
                  <p className="text-muted-foreground/60 mt-1 text-xs">{timeAgo(n.created_at)}</p>
                </div>
                {!n.read_at && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-shrink-0 text-xs"
                    onClick={() => markRead.mutate(n.notification_id)}
                  >
                    Mark read
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
