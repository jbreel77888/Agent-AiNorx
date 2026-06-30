'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '@/features/providers/auth-provider';
import { InstantSessionShell } from '@/features/session/instant-session-shell';
import { SessionChat } from '@/features/session/session-chat';
import { SessionStartingLoader } from '@/features/session/session-starting-loader';
import {
  useCanonicalOpenCodeSession,
} from '@/hooks/opencode/use-canonical-opencode-session';
import { OpenCodeEventStreamProvider } from '@/hooks/opencode/use-opencode-events';
import { useSandboxConnection } from '@/hooks/platform/use-sandbox-connection';
import { clearSessionFresh, isSessionFresh } from '@/lib/fresh-sessions';
import {
  sessionStartKey,
  startSession,
} from '@/lib/sessions-client';
import { sessionMark } from '@/lib/session-timing';
import { cn } from '@/lib/utils';
import {
  markProvisioningVerified,
  markRuntimeReadyVerified,
  useSandboxConnectionStore,
} from '@/stores/sandbox-connection-store';
import { useServerStore } from '@/stores/server-store';

/**
 * /sessions/[sessionId] — simple-mode (no GitHub) session view.
 *
 * Mirrors the project session page lifecycle but without a projectId:
 *   1. Polls POST /sessions/:sessionId/start until stage='ready' (with pin).
 *   2. Registers the sandbox in the server store + switches active server.
 *   3. Mounts SessionChat once the active server points at this sandbox.
 *
 * The URL stays at /sessions/<sessionId> the whole time.
 */
export default function SimpleSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth');
  }, [authLoading, user, router]);

  // ── Poll POST /sessions/:sessionId/start until stage='ready' or terminal ──
  const { data: start } = useQuery({
    queryKey: sessionStartKey(sessionId),
    queryFn: () => startSession(sessionId),
    enabled: !!user && !!sessionId,
    staleTime: 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 1000;
      // Session was deleted (404) — stop polling immediately. The redirect
      // effect below will send the user back to /sessions.
      if ('not_found' in data && data.not_found) return false;
      // Stop polling once we reach a terminal stage ('ready' or 'failed').
      if (data && 'stage' in data && (data.stage === 'ready' || data.stage === 'failed' || data.stage === 'stopped')) {
        return false;
      }
      return data && 'retriable' in data && data.retriable ? 1500 : false;
    },
  });

  // ── Redirect to /sessions if the session was deleted (404) ─────────────────
  useEffect(() => {
    if (start && 'not_found' in start && start.not_found) {
      console.warn(`[sessions] Session ${sessionId} not found — redirecting to /sessions`);
      router.replace('/sessions');
    }
  }, [start, sessionId, router]);

  // Normalize `start` — when it's `{ not_found: true }`, treat as null so the
  // rest of the component renders the loader (we're about to redirect anyway).
  const startData = start && 'not_found' in start ? null : start;
  const sandbox = startData?.sandbox ?? null;
  const startStage = startData?.stage ?? 'provisioning';

  // Subscribe to the active instance ID so we can gate chat mount on it.
  const activeInstanceId = useServerStore((s) => {
    const active = s.servers.find((entry) => entry.id === s.activeServerId);
    return active?.instanceId;
  });

  // ── When sandbox becomes ready, register + switch active server ──────────
  // Re-runs until activeInstanceId === sandbox.sandbox_id (idempotent + safe).
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
        if (startData?.stage === 'ready' && startData?.opencode_session_id) {
          markRuntimeReadyVerified();
        } else {
          markProvisioningVerified();
        }
        // Register the sandbox directly in the server store (no projectId needed).
        // This is the equivalent of switchToSessionSandboxAsync but works for
        // simple-mode sessions that aren't tied to a project.
        const store = useServerStore.getState();
        const provider = sandbox.provider as any;
        const serverId = store.registerOrUpdateSandbox(
          {
            label: `session ${sandbox.sandbox_id.slice(0, 8)}`,
            provider,
            sandboxId: sandbox.external_id,
            instanceId: sandbox.sandbox_id,
            mappedPorts: undefined,
          },
          { autoSwitch: false },
        );
        // Switch active server to this one (uses the store action so the SDK
        // client, connection store, and cookie all reset properly).
        store.setActiveServer(serverId, { force: true });
      } finally {
        switchingRef.current = false;
      }
    })();
  }, [sandbox, sessionId, activeInstanceId, startData?.stage, startData?.opencode_session_id]);

  useEffect(() => {
    if (sandbox && activeInstanceId === sandbox.sandbox_id) {
      sessionMark(sandbox.session_id, 'server-switched');
    }
  }, [activeInstanceId, sandbox]);

  // ── Crossfade state: loader → real chat ──────────────────────────────────
  const [chatReady, setChatReady] = useState(false);
  const [loaderMounted, setLoaderMounted] = useState(true);
  const [shellSubmitted, setShellSubmitted] = useState(false);
  const freshRef = useRef<boolean>(false);
  const lifecycleForRef = useRef<string | null>(null);
  if (lifecycleForRef.current !== sessionId) {
    lifecycleForRef.current = sessionId;
    if (chatReady) setChatReady(false);
    if (!loaderMounted) setLoaderMounted(true);
    let fresh = false;
    let pending = false;
    if (typeof window !== 'undefined') {
      pending =
        !!sessionStorage.getItem(`opencode_pending_prompt:${sessionId}`) ||
        !!sessionStorage.getItem(`project_pending_prompt:${sessionId}`);
      fresh = pending || isSessionFresh(sessionId);
    }
    freshRef.current = fresh;
    setShellSubmitted(pending);
  }
  const isFresh = freshRef.current;
  useEffect(() => {
    if (chatReady) clearSessionFresh(sessionId);
  }, [chatReady, sessionId]);

  // ── Render gates ──────────────────────────────────────────────────────────
  const fatal =
    !authLoading &&
    !!user &&
    !!sandbox &&
    (sandbox.status === 'error' || sandbox.status === 'stopped');

  const canMountChat =
    !!sandbox && sandbox.status === 'active' && activeInstanceId === sandbox.sandbox_id;
  const mountChat = canMountChat && (!isFresh || shellSubmitted);

  if (authLoading || !user) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <SessionStartingLoader stage="provisioning" />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {canMountChat && (
          <div
            className={cn(
              'absolute inset-0 flex min-h-0 flex-1 flex-col overflow-hidden transition-opacity duration-300 ease-out',
              chatReady ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
          >
            <SimpleSessionRuntimeConnection>
              <OpenCodeEventStreamProvider />
              {mountChat && (
                <ActiveSessionChat
                  sessionId={sessionId}
                  pinFromStart={startData?.opencode_session_id ?? null}
                  onChatReady={() => setChatReady(true)}
                />
              )}
            </SimpleSessionRuntimeConnection>
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
            {fatal ? (
              <InlineSessionError
                title={`Couldn't start session`}
                message={
                  sandbox?.status === 'error'
                    ? 'The sandbox for this session was terminated or failed to start. The session may have been deleted, or the provider quota was hit. Please delete this session and create a new one.'
                    : 'The sandbox for this session was stopped.'
                }
                action={
                  <button
                    onClick={() => router.replace('/sessions')}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 rounded-lg px-4 py-2 text-xs font-medium"
                  >
                    Back to Sessions
                  </button>
                }
              />
            ) : isFresh ? (
              <InstantSessionShell
                sessionId={sessionId}
                stage={startStage}
                onSubmit={() => setShellSubmitted(true)}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <SessionStartingLoader stage={startStage} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function SimpleSessionRuntimeConnection({ children }: { children: ReactNode }) {
  useSandboxConnection();
  return <>{children}</>;
}

function InlineSessionError({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <h2 className="text-foreground/90 text-sm font-medium">{title}</h2>
        <p className="text-muted-foreground/70 text-xs leading-relaxed">{message}</p>
        {action}
      </div>
    </div>
  );
}

/**
 * Renders SessionChat against this simple-mode session's sandbox.
 * Uses useCanonicalOpenCodeSession to resolve the OpenCode root, falling back
 * to the pin from /start (pinFromStart). The projectId arg is a sentinel —
 * the hook only uses it for the cache key + the project-session GET fallback,
 * both of which we bypass by always providing pinFromStart.
 */
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

  // Use a sentinel projectId for the hook. Since pinFromStart is always
  // provided from /start, the hook's project-session GET fallback never fires.
  const {
    rootSessionId,
    sessions: opencodeSessions,
    isLoading: sessionsLoading,
    listed: sessionsListed,
  } = useCanonicalOpenCodeSession({
    projectId: '__simple__',
    sessionId,
    pinFromStart,
  });

  const searchParams = useSearchParams();
  const selectedOpenCodeSessionId = searchParams.get('oc');
  const selectedSession = selectedOpenCodeSessionId
    ? opencodeSessions.find((session) => session.id === selectedOpenCodeSessionId)
    : null;

  const pinRef = useRef<{ sid: string; id: string | null }>({ sid: sessionId, id: null });
  if (pinRef.current.sid !== sessionId) pinRef.current = { sid: sessionId, id: null };
  if (!pinRef.current.id && rootSessionId) pinRef.current.id = rootSessionId;
  const chatSessionId = selectedSession?.id ?? pinRef.current.id ?? rootSessionId ?? null;

  // Migrate pending prompt onto the chat's session key (same pattern as project page).
  const promptMigratedForRef = useRef<string | null>(null);
  if (
    typeof window !== 'undefined' &&
    chatSessionId &&
    promptMigratedForRef.current !== chatSessionId
  ) {
    promptMigratedForRef.current = chatSessionId;
    const fromKey = `project_pending_prompt:${sessionId}`;
    const pending = sessionStorage.getItem(fromKey);
    if (pending) {
      const toKey = `opencode_pending_prompt:${chatSessionId}`;
      if (sessionStorage.getItem(toKey) === null) sessionStorage.setItem(toKey, pending);
      sessionStorage.removeItem(fromKey);
    }
    const fromOptKey = `project_pending_options:${sessionId}`;
    const pendingOptions = sessionStorage.getItem(fromOptKey);
    if (pendingOptions) {
      const toOptKey = `opencode_pending_options:${chatSessionId}`;
      if (sessionStorage.getItem(toOptKey) === null)
        sessionStorage.setItem(toOptKey, pendingOptions);
      sessionStorage.removeItem(fromOptKey);
    }
  }

  // Report chat ready to the parent for crossfade.
  useEffect(() => {
    if (runtimeReady && chatSessionId && sessionsListed) {
      onChatReady?.();
    }
  }, [runtimeReady, chatSessionId, sessionsListed, onChatReady]);

  // Wait until we have a chatSessionId to mount SessionChat.
  if (!chatSessionId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <SessionChat sessionId={chatSessionId} />;
}
