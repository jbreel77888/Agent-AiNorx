'use client';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AppHeader } from '@/features/layout/app-header';
import { useAuth } from '@/features/providers/auth-provider';
import { createSession, deleteSession, listSessions, type SimpleSession } from '@/lib/sessions-client';
import { markSessionFresh } from '@/lib/fresh-sessions';
import { Plus, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function SessionsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();
  const [query, setQuery] = useState('');

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

  const filtered = sessions?.filter(s =>
    s.name.toLowerCase().includes(query.toLowerCase())
  ) ?? [];

  return (
    <div className="flex h-full w-full flex-col">
      <AppHeader user={user} breadcrumb="Sessions" logoHref="/sessions" />
      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-foreground text-2xl font-semibold tracking-tight">Sessions</h1>
              <p className="text-muted-foreground mt-1 text-sm">Your standalone AI agent sessions</p>
            </div>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="gap-2">
              <Plus className="h-4 w-4" />
              New Session
            </Button>
          </div>

          <input
            type="text"
            placeholder="Search sessions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border-border bg-background w-full max-w-md rounded-lg border px-4 py-2 text-sm"
          />

          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center justify-center py-12">
              <p className="text-sm">No sessions yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((session) => (
                <div
                  key={session.session_id}
                  className="border-border bg-card group cursor-pointer rounded-xl border p-4 transition-shadow hover:shadow-md"
                  onClick={() => router.push(`/sessions/${session.session_id}`)}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-foreground font-medium">{session.name}</h3>
                      <p className="text-muted-foreground text-xs">
                        {new Date(session.updated_at).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteMutation.mutate(session.session_id);
                      }}
                      className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      session.status === 'running' ? 'bg-green-500/10 text-green-600'
                        : session.status === 'provisioning' ? 'bg-yellow-500/10 text-yellow-600'
                        : session.status === 'failed' ? 'bg-red-500/10 text-red-600'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {session.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
