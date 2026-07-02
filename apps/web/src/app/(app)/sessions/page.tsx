'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/features/providers/auth-provider';
import { createSession, listSessions, type SimpleSession } from '@/lib/sessions-client';
import { markSessionFresh } from '@/lib/fresh-sessions';
import { Plus, MessageSquare, Sparkles } from 'lucide-react';
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
    <div className="flex h-full w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 px-6 text-center">
        {/* Logo */}
        <div className="bg-primary/10 flex h-20 w-20 items-center justify-center rounded-3xl">
          <Sparkles className="text-primary h-10 w-10" />
        </div>

        {/* Welcome text */}
        <div className="space-y-2">
          <h1 className="text-foreground text-2xl font-bold tracking-tight">
            Welcome to VaelorX
          </h1>
          <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
            Your AI-powered workspace by Digital Planetx. Create a session to
            start chatting with your intelligent agent — no setup required.
          </p>
        </div>

        {/* New Session button */}
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-medium shadow-lg transition-all hover:shadow-xl"
        >
          {createMutation.isPending ? (
            <MessageSquare className="h-5 w-5 animate-pulse" />
          ) : (
            <Plus className="h-5 w-5" />
          )}
          New Session
        </button>

        {/* Feature hints */}
        <div className="text-muted-foreground/60 mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-xs">
          <span>🚀 Instant sandbox</span>
          <span>💬 Real-time streaming</span>
          <span>🧠 Agent memory</span>
          <span>📁 File management</span>
        </div>
      </div>
    </div>
  );
}
