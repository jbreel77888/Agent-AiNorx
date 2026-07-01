'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Component, type ReactNode } from 'react';

import { useAuth } from '@/features/providers/auth-provider';
import { InstantSessionShell } from '@/features/session/instant-session-shell';
import { SessionChat } from '@/features/session/session-chat';
import { SessionStartingLoader } from '@/features/session/session-starting-loader';
import { OpenCodeEventStreamProvider } from '@/hooks/opencode/use-opencode-events';
import { useSandboxConnection } from '@/hooks/platform/use-sandbox-connection';
import { clearSessionFresh, isSessionFresh } from '@/lib/fresh-sessions';
import {
  sessionStartKey,
  startSession,
  type SessionStartResult,
} from '@/lib/sessions-client';
import {
  useSandboxConnectionStore,
} from '@/stores/sandbox-connection-store';
import { useServerStore } from '@/stores/server-store';
import { cn } from '@/lib/utils';

// Error boundary to prevent white screens
class SessionErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

export default function SimpleSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth');
  }, [authLoading, user, router]);

  const { data: start } = useQuery({
    queryKey: sessionStartKey(sessionId),
    queryFn: () => startSession(sessionId),
    enabled: !!user && !!sessionId,
    staleTime: 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 1500;
      if ('not_found' in data && data.not_found) return false;
      if (data && 'stage' in data) {
        if (data.stage === 'ready' || data.stage === 'failed' || data.stage === 'stopped') {
          return false;
        }
      }
      return 2000;
    },
  });

  useEffect(() => {
    if (start && 'not_found' in start && start.not_found) {
      router.replace('/sessions');
    }
  }, [start, sessionId, router]);

  const startData = start && 'not_found' in start ? null : start as SessionStartResult | null;
  const sandbox = startData?.sandbox ?? null;
  const startStage = startData?.stage ?? 'provisioning';
  const opencodeSessionId = startData?.opencode_session_id ?? null;

  const activeInstanceId = useServerStore((s) => {
    const active = s.servers.find((entry) => entry.id === s.activeServerId);
    return active?.instanceId;
  });

  const switchingRef = useRef(false);
  useEffect(() => {
    if (!sandbox || !sessionId) return;
    if (sandbox.status !== 'active' || !sandbox.external_id) return;
    if (activeInstanceId === sandbox.sandbox_id) return;
    if (switchingRef.current) return;
    switchingRef.current = true;
    (async () => {
      try {
        const store = useServerStore.getState();
        const serverId = store.registerOrUpdateSandbox(
          {
            label: `session ${sandbox.sandbox_id.slice(0, 8)}`,
            provider: sandbox.provider as any,
            sandboxId: sandbox.external_id,
            instanceId: sandbox.sandbox_id,
            mappedPorts: undefined,
          },
          { autoSwitch: false },
        );
        store.setActiveServer(serverId, { force: true });
      } finally {
        switchingRef.current = false;
      }
    })();
  }, [sandbox, sessionId, activeInstanceId]);

  const runtimeReady = useSandboxConnectionStore(
    (s) => s.status === 'connected' && s.healthy === true,
  );

  useSandboxConnection();

  const sandboxSwitched = sandbox && activeInstanceId === sandbox.sandbox_id;
  const canShowChat = !!(sandboxSwitched && runtimeReady && opencodeSessionId);

  // Fresh session detection
  const [isFresh] = useState(() => isSessionFresh(sessionId));

  // Crossfade state
  const [chatReady, setChatReady] = useState(false);
  const [shellMounted, setShellMounted] = useState(true);

  useEffect(() => {
    if (canShowChat && !chatReady) {
      const t = setTimeout(() => setChatReady(true), 300);
      return () => clearTimeout(t);
    }
  }, [canShowChat, chatReady]);

  useEffect(() => {
    if (chatReady) {
      clearSessionFresh(sessionId);
      const t = setTimeout(() => setShellMounted(false), 400);
      return () => clearTimeout(t);
    }
  }, [chatReady, sessionId]);

  if (authLoading || !user) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <SessionStartingLoader stage="provisioning" />
      </div>
    );
  }

  if (sandbox && (sandbox.status === 'error' || sandbox.status === 'stopped')) {
    return (
      <div className="flex h-full w-full items-center justify-center px-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <h2 className="text-foreground text-sm font-medium">Couldn't start session</h2>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {sandbox.status === 'error'
              ? 'The sandbox failed to start or was terminated. Please delete this session and create a new one.'
              : 'The sandbox for this session was stopped.'}
          </p>
          <button
            onClick={() => router.replace('/sessions')}
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 rounded-lg px-4 py-2 text-xs font-medium"
          >
            Back to Sessions
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      {/* Chat layer */}
      {canShowChat && (
        <div
          className={cn(
            'absolute inset-0 flex min-h-0 flex-1 flex-col transition-opacity duration-300 ease-out',
            chatReady ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          <OpenCodeEventStreamProvider />
          <SessionChat sessionId={opencodeSessionId!} />
        </div>
      )}

      {/* Shell / Loader layer */}
      {!chatReady && shellMounted && (
        <div
          className={cn(
            'absolute inset-0 flex flex-col transition-opacity duration-300 ease-out',
            chatReady ? 'pointer-events-none opacity-0' : 'opacity-100',
          )}
        >
          <SessionErrorBoundary
            fallback={
              <div className="flex h-full w-full items-center justify-center">
                <SessionStartingLoader stage={startStage} />
              </div>
            }
          >
            {isFresh ? (
              <InstantSessionShell
                sessionId={sessionId}
                stage={startStage}
                onSubmit={() => {}}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <SessionStartingLoader stage={startStage} />
              </div>
            )}
          </SessionErrorBoundary>
        </div>
      )}
    </div>
  );
}
