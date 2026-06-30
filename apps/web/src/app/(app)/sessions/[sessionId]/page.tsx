'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Icon } from '@/features/icon/icon';
import { AppHeader } from '@/features/layout/app-header';
import { useAuth } from '@/features/providers/auth-provider';
import { getSession, type SimpleSessionDetail } from '@/lib/sessions-client';
import { ArrowLeft, MessageSquare, Terminal, FileCode, Eye } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SessionStartingLoader } from '@/features/session/session-starting-loader';

export default function SessionDetailPage() {
  const tI18nHardcoded = useTranslations('hardcodedUi');
  const router = useRouter();
  const params = useParams();
  const sessionId = params.sessionId as string;
  const { user, isLoading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<'chat' | 'files' | 'terminal' | 'preview'>('chat');

  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth');
  }, [authLoading, user, router]);

  const { data: session, isLoading } = useQuery<SimpleSessionDetail>({
    queryKey: ['session', sessionId],
    queryFn: () => getSession(sessionId),
    enabled: !!user && !!sessionId,
    refetchInterval: 5000, // poll for status updates
  });

  if (isLoading || !session) {
    return (
      <div className="flex h-full w-full flex-col">
        <AppHeader />
        <div className="flex flex-1 items-center justify-center">
          <Skeleton className="h-32 w-96 rounded-xl" />
        </div>
      </div>
    );
  }

  const isProvisioning = session.status === 'provisioning';
  const isReady = session.status === 'running' && session.sandbox?.status === 'active';

  const tabs = [
    { id: 'chat' as const, label: 'Chat', icon: MessageSquare },
    { id: 'files' as const, label: 'Files', icon: FileCode },
    { id: 'terminal' as const, label: 'Terminal', icon: Terminal },
    { id: 'preview' as const, label: 'Preview', icon: Eye },
  ];

  return (
    <div className="flex h-full w-full flex-col">
      <AppHeader />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 border-r border-border bg-muted/30 p-4">
          <button
            onClick={() => router.push('/sessions')}
            className="text-muted-foreground mb-4 flex items-center gap-2 text-sm hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Sessions
          </button>

          <div className="mb-6">
            <h2 className="text-foreground truncate font-semibold">
              {session.name}
            </h2>
            <p className="text-muted-foreground mt-1 text-xs">
              {new Date(session.created_at).toLocaleString()}
            </p>
            <span
              className={`mt-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                session.status === 'running'
                  ? 'bg-green-500/10 text-green-600'
                  : session.status === 'provisioning'
                    ? 'bg-yellow-500/10 text-yellow-600'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {session.status}
            </span>
          </div>

          {/* Tabs */}
          <nav className="space-y-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    activeTab === tab.id
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-hidden">
          {isProvisioning ? (
            <div className="flex h-full items-center justify-center">
              <SessionStartingLoader stage="provisioning" delayMs={0} />
            </div>
          ) : (
            <div className="h-full p-4">
              {activeTab === 'chat' && (
                <div className="flex h-full flex-col">
                  <div className="flex-1 overflow-auto rounded-lg border border-border p-4">
                    <p className="text-muted-foreground text-center text-sm">
                      {isReady
                        ? 'Chat is ready. Start a conversation with your AI agent.'
                        : 'Waiting for sandbox to become ready...'}
                    </p>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <input
                      type="text"
                      placeholder="Type a message..."
                      className="flex-1 rounded-lg border border-border bg-background px-4 py-2 text-sm"
                      disabled={!isReady}
                    />
                    <Button disabled={!isReady}>Send</Button>
                  </div>
                </div>
              )}
              {activeTab === 'files' && (
                <div className="h-full rounded-lg border border-border p-4">
                  <p className="text-muted-foreground text-center text-sm">
                    File browser will appear here when the sandbox is ready.
                  </p>
                </div>
              )}
              {activeTab === 'terminal' && (
                <div className="h-full rounded-lg border border-border bg-black p-4">
                  <p className="text-muted-foreground text-center text-sm">
                    Terminal will appear here when the sandbox is ready.
                  </p>
                </div>
              )}
              {activeTab === 'preview' && (
                <div className="h-full rounded-lg border border-border p-4">
                  <p className="text-muted-foreground text-center text-sm">
                    Preview will appear here when the sandbox is ready.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
