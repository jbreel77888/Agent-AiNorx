'use client';

import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, ArrowLeft } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { AppHeader } from '@/features/layout/app-header';
import { useAuth } from '@/features/providers/auth-provider';
import { InstantSessionShell } from '@/features/session/instant-session-shell';
import { SessionChat } from '@/features/session/session-chat';
import { SessionLayout } from '@/features/session/session-layout';
import { SessionStartingLoader } from '@/features/session/session-starting-loader';
import { OpenCodeEventStreamProvider } from '@/hooks/opencode/use-opencode-events';
import { useSandboxConnection } from '@/hooks/platform/use-sandbox-connection';
import { isSessionFresh, clearSessionFresh } from '@/lib/fresh-sessions';
import {
  startSession,
  sessionStartKey,
  type SessionStartResult,
} from '@/lib/sessions-client';
import { sessionMark } from '@/lib/session-timing';
import { cn } from '@/lib/utils';
import {
  markProvisioningVerified,
  markRuntimeReadyVerified,
  useSandboxConnectionStore,
} from '@/stores/sandbox-connection-store';
import { switchToSessionSandboxAsync, useServerStore } from '@/stores/server-store';
import { setActiveInstanceCookie } from '@/lib/instance-routes';

/**
 * /sessions/[sessionId] — standalone session view (no project).
 *
 * This is the simple-mode equivalent of /projects/[id]/sessions/[sessionId].
 * It reuses the EXACT same components (SessionChat, SessionLayout, etc.)
 * but gets sandbox info from /v1/sessions/:sessionId/start instead of
 * /v1/projects/:id/sessions/:sessionId/start.
 */
export default function SessionPage() {
  const tHardcodedUi = useTranslations('hardcodedUi');
  const { sessionId } = useParams<{ sessionId: string }>();
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Poll /v1/sessions/:sessionId/start for readiness
  const { data: start } = useQuery<SessionStartResult | null>({
    queryKey: sessionStartKey(sessionId),
    queryFn: () => startSession(sessionId),
    enabled: !!user && !!sessionId,
    staleTime: 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 500;
      return data.retriable ? 800 : false;
    },
  });

  const sandbox = start?.sandbox ?? null;
  const startStage = start?.stage ?? 'provisioning';

  // Active server switching — same logic as project session page
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
    sessionMark(sandbox.session_id, 'sandbox-active');
    (async () => {
      try {
        if (start?.stage === 'ready' && start?.opencode_session_id) {
          markRuntimeReadyVerified();
        } else {
          markProvisioningVerified();
        }
        // Use a virtual projectId for the switch (the store needs one)
        await switchToSessionSandboxAsync('sessions', sandbox.sandbox_id, {
          ...sandbox,
          project_id: null,
        } as any);
        setActiveInstanceCookie(null);
      } finally {
        switchingRef.current = false;
      }
    })();
  }, [sandbox, sessionId, activeInstanceId, start?.stage, start?.opencode_session_id]);

  useEffect(() => {
    setActiveInstanceCookie(null);
  }, []);

  // Session freshness (optimistic creation)
  const isFresh = isSessionFresh(sessionId);

  // Chat readiness state
  const [chatReady, setChatReady] = useState(false);
  const [loaderMounted, setLoaderMounted] = useState(true);
  const [shellSubmitted, setShellSubmitted] = useState(false);
  const [mountChat, setMountChat] = useState(false);

  useEffect(() => {
    if (shellSubmitted || start?.stage === 'ready') {
      setMountChat(true);
    }
  }, [shellSubmitted, start?.stage]);

  const canMountChat = !!sandbox && sandbox.status === 'active' && !!sandbox.external_id &&
    activeInstanceId === sandbox.sandbox_id;

  // Clear freshness once chat is ready
  useEffect(() => {
    if (chatReady) {
      clearSessionFresh(sessionId);
      sessionMark(sessionId, 'chat-ready');
    }
  }, [chatReady, sessionId]);

  // Inner content — same structure as project session page
  const inner = (() => {
    if (authLoading || !user) {
      return <SessionStartingLoader stage="provisioning" />;
    }

    if (!start) {
      return <SessionStartingLoader stage="provisioning" />;
    }

    if (start.stage === 'failed' || (sandbox && sandbox.status === 'error')) {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6">
          <div className="flex max-w-md flex-col items-center gap-3 text-center">
            <h2 className="text-foreground/90 text-sm font-medium">Session failed</h2>
            <p className="text-muted-foreground/70 text-xs leading-relaxed">
              Something went wrong while provisioning this session.
            </p>
          </div>
        </div>
      );
    }

    if (sandbox && sandbox.status === 'archived') {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6">
          <div className="flex max-w-md flex-col items-center gap-3 text-center">
            <h2 className="text-foreground/90 text-sm font-medium">Session stopped</h2>
            <p className="text-muted-foreground/70 text-xs leading-relaxed">
              This session was stopped. Create a new one to continue.
            </p>
            <Button variant="outline" size="sm" onClick={() => router.push('/sessions')}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Sessions
            </Button>
          </div>
        </div>
      );
    }

    // Dual-layer: chat mounts under the loader and crossfades in
    return (
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {canMountChat && (
          <div
            className={cn(
              'absolute inset-0 flex min-h-0 flex-1 flex-col overflow-hidden transition-opacity duration-300 ease-out',
              chatReady ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
          >
            <SessionRuntimeConnection>
              <OpenCodeEventStreamProvider />
              {mountChat && (
                <ActiveSessionChat
                  sessionId={sessionId}
                  pinFromStart={start?.opencode_session_id ?? null}
                  onChatReady={() => setChatReady(true)}
                />
              )}
            </SessionRuntimeConnection>
          </div>
        )}

        {loaderMounted && (
          <div
            onTransitionEnd={() => {
              if (chatReady) setLoaderMounted(false);
            }}
            className={cn(
              'absolute inset-0 flex flex-col transition-opacity duration-300 ease-out',
              chatReady ? 'pointer-events-none opacity-0' : 'opacity-100',
            )}
          >
            {isFresh ? (
              <InstantSessionShell
                projectId="sessions"
                sessionId={sessionId}
                stage={startStage}
                onSubmit={() => setShellSubmitted(true)}
              />
            ) : (
              <SessionStartingLoader stage={startStage} />
            )}
          </div>
        )}
      </div>
    );
  })();

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
      {inner}
    </div>
  );
}

function SessionRuntimeConnection({ children }: { children: React.ReactNode }) {
  useSandboxConnection();
  return <>{children}</>;
}

function ActiveSessionChat({
  sessionId,
  pinFromStart,
  onChatReady,
}: {
  sessionId: string;
  pinFromStart: string | null;
  onChatReady?: () => void;
}) {
  const runtimeReady = useSandboxConnectionStore(
    (s) => s.status === 'connected' && s.healthy === true,
  );
  const runtimeBootError = useSandboxConnectionStore((s) => s.runtimeError);

  // In simple mode, we use the opencode_session_id from the /start response
  // directly — no need for useCanonicalOpenCodeSession (which requires a real project).
  // The daemon creates the root opencode session on boot.
  const rootSessionId = pinFromStart;

  useEffect(() => {
    if (runtimeReady) sessionMark(sessionId, 'runtime-ready');
  }, [runtimeReady, sessionId]);

  const chatShowable =
    (!!rootSessionId && runtimeReady) || (!runtimeReady && !!runtimeBootError);
  useEffect(() => {
    if (chatShowable) onChatReady?.();
  }, [chatShowable, onChatReady]);

  if (!runtimeReady && runtimeBootError) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <h2 className="text-foreground/90 text-sm font-medium">OpenCode runtime is not ready</h2>
          <p className="text-muted-foreground/70 text-xs leading-relaxed">
            The sandbox booted, but the project runtime did not become usable.
          </p>
          {runtimeBootError && (
            <p className="border-border/60 bg-muted/40 text-muted-foreground max-w-full rounded-2xl border px-2 py-1 font-mono text-xs leading-relaxed">
              {runtimeBootError}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!rootSessionId) return null;

  return (
    <SessionLayout
      key={rootSessionId}
      sessionId={rootSessionId}
      projectId="sessions"
      projectSessionId={sessionId}
    >
      <SessionChat key={rootSessionId} sessionId={rootSessionId} />
    </SessionLayout>
  );
}
