'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/features/providers/auth-provider';
import { createSession, listSessions, type SimpleSession } from '@/lib/sessions-client';
import { markSessionFresh } from '@/lib/fresh-sessions';
import { Plus, MessageSquare } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

export default function SessionsPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const { data: sessions } = useQuery<SimpleSession[]>({
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

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth');
  }, [authLoading, user, router]);

  // Auto-redirect to the most recent session if one exists
  useEffect(() => {
    if (sessions && sessions.length > 0 && !createMutation.isPending) {
      router.replace(`/sessions/${sessions[0].session_id}`);
    }
  }, [sessions, router, createMutation.isPending]);

  if (authLoading || !user) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="bg-muted flex h-16 w-16 items-center justify-center rounded-2xl">
          <MessageSquare className="text-muted-foreground h-8 w-8" />
        </div>
        <div>
          <h2 className="text-foreground text-lg font-semibold">Welcome to VaelorX</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Create a new session to start chatting with your AI agent
          </p>
        </div>
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
        >
          <Plus className="h-4 w-4" />
          New Session
        </button>
      </div>
    </div>
  );
}
