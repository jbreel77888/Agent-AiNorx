'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { createSession, deleteSession, listSessions, type SimpleSession } from '@/lib/sessions-client';
import { markSessionFresh } from '@/lib/fresh-sessions';
import { cn } from '@/lib/utils';
import { useParams } from 'next/navigation';

export function SimpleSessionList() {
  const router = useRouter();
  const params = useParams();
  const queryClient = useQueryClient();
  const activeSessionId = params?.sessionId as string | undefined;

  const { data: sessions, isLoading } = useQuery<SimpleSession[]>({
    queryKey: ['sessions'],
    queryFn: listSessions,
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

  return (
    <div className="flex h-full flex-col">
      {/* New Session button */}
      <div className="p-2">
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
        >
          {createMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          New Session
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {isLoading ? (
          <div className="text-muted-foreground p-2 text-xs">Loading...</div>
        ) : !sessions || sessions.length === 0 ? (
          <div className="text-muted-foreground p-2 text-xs">No sessions yet</div>
        ) : (
          <div className="flex flex-col gap-0.5">
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
                <span className="flex-1 truncate">{session.name || 'Untitled'}</span>
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
                        ? 'bg-yellow-500 animate-pulse'
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
    </div>
  );
}
