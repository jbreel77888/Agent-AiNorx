'use client';

import { AppProviders } from '@/features/layout/app-providers';
import { useAuth } from '@/features/providers/auth-provider';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

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
      <div className="relative flex h-dvh min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </AppProviders>
  );
}
