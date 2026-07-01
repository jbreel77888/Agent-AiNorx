'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/features/providers/auth-provider';
import { createSession, deleteSession, listSessions, type SimpleSession } from '@/lib/sessions-client';
import { markSessionFresh } from '@/lib/fresh-sessions';
import { Plus, Trash2, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect } from 'react';

export default function SessionsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useParams();
  const { user, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  
  const activeSessionId = params?.sessionId as string | undefined;

  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth');
  }, [authLoading, user, router]);

  const { data: sessions, isLoading } = useQuery<SimpleSession[]>({
    queryKey: ['sessions'],
    queryFn: listSessions,
    enabled: !!user,
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const sessionId = crypto.randomUUID();
      markSessionFresh(sessionId);
      router.push(`/sessions/${sessionId}`);
      return createSession({ name: 'New Session', session_id: sessionId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => deleteSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  if (authLoading || !user) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Sidebar */}
      <aside className="bg-card border-border flex w-72 shrink-0 flex-col border-r">
        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <h1 className="text-foreground text-sm font-semibold">Sessions</h1>
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-7 w-7 items-center justify-center rounded-md"
            title="New Session"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="text-muted-foreground p-4 text-xs">Loading sessions...</div>
          ) : !sessions || sessions.length === 0 ? (
            <div className="text-muted-foreground p-4 text-xs">
              No sessions yet. Click + to create one.
            </div>
          ) : (
            <div className="flex flex-col gap-0.5 p-2">
              {sessions.map((session) => (
                <div
                  key={session.session_id}
                  className={cn(
                    'group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                    activeSessionId === session.session_id
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                  onClick={() => router.push(`/sessions/${session.session_id}`)}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">{session.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteMutation.mutate(session.session_id);
                      if (activeSessionId === session.session_id) {
                        router.push('/sessions');
                      }
                    }}
                    className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      session.status === 'running'
                        ? 'bg-green-500'
                        : session.status === 'provisioning'
                          ? 'bg-yellow-500'
                          : session.status === 'failed'
                            ? 'bg-red-500'
                            : 'bg-muted-foreground/30',
                    )}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-border flex items-center gap-2 border-t px-4 py-3">
          <div className="bg-muted flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium">
            {user.email?.[0]?.toUpperCase() || 'U'}
          </div>
          <span className="text-muted-foreground truncate text-xs">{user.email}</span>
        </div>
      </aside>

      {/* Main content area */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
