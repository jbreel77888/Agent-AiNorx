'use client';

import { AppProviders } from '@/features/layout/app-providers';
import { useAuth } from '@/features/providers/auth-provider';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { TunnelPermissionRequestDialog } from '@/components/tunnel/tunnel-permission-request-dialog';
import { useTunnelRealtimeSync } from '@/hooks/tunnel/use-tunnel-realtime';

export default function SessionsLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth');
  }, [authLoading, user, router]);

  // Subscribe to tunnel SSE events (permission requests, connect/disconnect)
  // at the layout level so every page under /sessions gets real-time updates.
  useTunnelRealtimeSync();

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
      <div className="relative flex h-dvh min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
      {/* Global permission-request dialog — pops when the agent requests
          an operation on the user's computer that isn't pre-approved.
          Driven by SSE from /v1/tunnel/permission-requests/stream. */}
      <TunnelPermissionRequestDialog />
    </AppProviders>
  );
}
