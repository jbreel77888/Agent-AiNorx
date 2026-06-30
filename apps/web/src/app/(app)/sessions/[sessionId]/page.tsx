'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { AppHeader } from '@/features/layout/app-header';
import { useAuth } from '@/features/providers/auth-provider';
import { SessionStartingLoader } from '@/features/session/session-starting-loader';
import { startSession, sessionStartKey, type SessionStartResult } from '@/lib/sessions-client';

export default function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth');
  }, [authLoading, user, router]);

  const { data: start } = useQuery<SessionStartResult | null>({
    queryKey: sessionStartKey(sessionId),
    queryFn: () => startSession(sessionId),
    enabled: !!user && !!sessionId,
    staleTime: 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 1000;
      return data.retriable ? 2000 : false;
    },
  });

  if (authLoading || !user) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <SessionStartingLoader stage="provisioning" />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <AppHeader user={user} breadcrumb="Session" logoHref="/sessions" />
      <div className="flex flex-1 items-center justify-center">
        <SessionStartingLoader
          stage={start?.stage ?? 'provisioning'}
        />
      </div>
    </div>
  );
}
