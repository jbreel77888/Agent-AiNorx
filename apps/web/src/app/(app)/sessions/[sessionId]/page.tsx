'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { useAuth } from '@/features/providers/auth-provider';
import { SessionChat } from '@/features/session/session-chat';
import { SessionStartingLoader } from '@/features/session/session-starting-loader';
import { OpenCodeEventStreamProvider } from '@/hooks/opencode/use-opencode-events';
import { useSandboxConnection } from '@/hooks/platform/use-sandbox-connection';
import {
  sessionStartKey,
  startSession,
  type SessionStartResult,
} from '@/lib/sessions-client';
import {
  useSandboxConnectionStore,
} from '@/stores/sandbox-connection-store';
import { useServerStore } from '@/stores/server-store';

/**
 * /sessions/[sessionId] — simple-mode (no GitHub) session view.
 *
 * Lifecycle:
 *   1. Polls POST /sessions/:sessionId/start until stage='ready' (with pin).
 *   2. Registers the sandbox in the server store + switches active server.
 *   3. Mounts SessionChat once the sandbox is connected + healthy.
 *
 * 
 * the user can type into immediately) while the sandbox boots. The setup steps
 * only appear AFTER the user sends a message — inline below their message,
 * matching the original project-mode UX.
 *
 * 
 * while the sandbox wakes up.
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

  // ── Redirect to /sessions if the session was deleted (404) ─────────────────
  useEffect(() => {
    if (start && 'not_found' in start && start.not_found) {
      router.replace('/sessions');
    }
  }, [start, sessionId, router]);

  // Normalize start data
  const startData = start && 'not_found' in start ? null : start as SessionStartResult | null;
  const sandbox = startData?.sandbox ?? null;
  const startStage = startData?.stage ?? 'provisioning';
  const opencodeSessionId = startData?.opencode_session_id ?? null;

  // Subscribe to the active instance ID
  const activeInstanceId = useServerStore((s) => {
    const active = s.servers.find((entry) => entry.id === s.activeServerId);
    return active?.instanceId;
  });

  // ── When sandbox becomes ready, register + switch active server ──────────
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

  // ── Track runtime readiness ───────────────────────────────────────────────
  const runtimeReady = useSandboxConnectionStore(
    (s) => s.status === 'connected' && s.healthy === true,
  );

  // ALWAYS mount useSandboxConnection so it can poll health and set runtimeReady.
  useSandboxConnection();

  // Determine if we can show chat
  const sandboxSwitched = sandbox && activeInstanceId === sandbox.sandbox_id;
  const canShowChat = !!(sandboxSwitched && runtimeReady && opencodeSessionId);

  // Track if this is a fresh session (for future use — currently just shows loader)

  // ── Render ──────────────────────────────────────────────────────────────────
  if (authLoading || !user) {
    return <FullScreenLoader stage="provisioning" />;
  }

  // Fatal error
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
      {/* Chat layer — mounted only when everything is ready */}
      {canShowChat && (
        <div className="flex min-h-0 flex-1 flex-col">
          <OpenCodeEventStreamProvider />
          <SessionChat sessionId={opencodeSessionId!} />
        </div>
      )}

      {/* Loader layer — shown while sandbox is provisioning/booting */}
      {!canShowChat && (
        <FullScreenLoader stage={startStage} />
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function FullScreenLoader({ stage }: { stage: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <SessionStartingLoader stage={stage as any} />
    </div>
  );
}
