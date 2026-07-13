/**
 * Session hooks — React Query hooks for session management.
 *
 * These are the NEW top-level session hooks that use /v1/sessions/*
 * instead of /v1/projects/{id}/sessions/*.
 *
 * Mirrors the web's session hooks but adapted for React Native + Expo.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listSessions,
  createSession,
  startSession,
  restartSession,
  renameSession,
  deleteSession,
  bulkDeleteSessions,
  getSessionHealth,
  sessionKeys,
} from './sessions-client';
import type { CreateSessionInput, SessionStartResult } from './types';

// ── List Sessions ─────────────────────────────────────────────────────────────

export function useSessions(enabled = true) {
  return useQuery({
    queryKey: sessionKeys.list,
    queryFn: listSessions,
    enabled,
    refetchInterval: 10_000, // refresh every 10s
  });
}

// ── Create Session ────────────────────────────────────────────────────────────

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSessionInput) => createSession(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionKeys.list });
    },
  });
}

// ── Start/Resume Session ──────────────────────────────────────────────────────

export function useStartSession() {
  return useMutation({
    mutationFn: (sessionId: string) => startSession(sessionId),
  });
}

/**
 * Poll session start status until ready/failed.
 * Use this in a polling loop after creating or opening a session.
 */
export function useSessionStartPolling(sessionId: string | null, enabled = true) {
  return useQuery({
    queryKey: sessionId ? sessionKeys.start(sessionId) : ['sessions', 'start', 'idle'],
    queryFn: () => startSession(sessionId!),
    enabled: !!sessionId && enabled,
    refetchInterval: (data) => {
      // Stop polling when ready or failed
      if (data?.stage === 'ready' || data?.stage === 'failed') return false;
      if (data && 'not_found' in data) return false;
      return 3000; // poll every 3s
    },
    refetchIntervalInBackground: true,
  });
}

// ── Restart Session ───────────────────────────────────────────────────────────

export function useRestartSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => restartSession(sessionId),
    onSuccess: (_, sessionId) => {
      qc.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
      qc.invalidateQueries({ queryKey: sessionKeys.start(sessionId) });
    },
  });
}

// ── Rename Session ────────────────────────────────────────────────────────────

export function useRenameSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, name }: { sessionId: string; name: string }) =>
      renameSession(sessionId, name),
    onSuccess: (_, { sessionId }) => {
      qc.invalidateQueries({ queryKey: sessionKeys.list });
      qc.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
    },
  });
}

// ── Delete Session ────────────────────────────────────────────────────────────

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => deleteSession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionKeys.list });
    },
  });
}

// ── Bulk Delete ───────────────────────────────────────────────────────────────

export function useBulkDeleteSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionIds: string[]) => bulkDeleteSessions(sessionIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionKeys.list });
    },
  });
}

// ── Session Health ────────────────────────────────────────────────────────────

export function useSessionHealth(sessionId: string | null, enabled = true) {
  return useQuery({
    queryKey: sessionId ? sessionKeys.health(sessionId) : ['sessions', 'health', 'idle'],
    queryFn: () => getSessionHealth(sessionId!),
    enabled: !!sessionId && enabled,
    refetchInterval: 5_000, // check every 5s
  });
}
