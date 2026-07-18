'use client';

import { AppProviders } from '@/features/layout/app-providers';
import { useAuth } from '@/features/providers/auth-provider';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useTunnelRealtimeSync } from '@/hooks/tunnel/use-tunnel-realtime';

// Inner component that runs INSIDE AppProviders so hooks like useQueryClient
// (used by useTunnelRealtimeSync) have their providers available.
function SessionsInner({ children }: { children: React.ReactNode }) {
  // Subscribe to tunnel SSE events (permission requests, connect/disconnect)
  // at the layout level so every page under /sessions gets real-time updates.
  useTunnelRealtimeSync();

  return (
    <div className="relative flex h-dvh min-h-0 flex-1 flex-col overflow-hidden">
      {children}
    </div>
  );
}

export default function SessionsLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth');
  }, [authLoading, user, router]);

  if (authLoading || !user) {
    return <div className="bg-background h-dvh" />;
  }

  return (
    <AppProviders
      showSidebar
      showRightSidebar={false}
      showGlobalNewInstanceModal={false}
      showGlobalUserSettingsModal={false}
    >
      <SessionsInner>{children}</SessionsInner>
    </AppProviders>
  );
}
