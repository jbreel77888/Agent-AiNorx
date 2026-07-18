'use client';

/**
 * usePlatformDefaultModel — fetches the admin-configured default model
 * from the API gateway. Used to OVERRIDE stale localStorage selections
 * in the OpenCode model store.
 *
 * Why this exists:
 *   The frontend's use-model-store.ts saves the user's model choice in
 *   localStorage (per-session, per-agent, globalDefault). When the admin
 *   changes the default model in the dashboard, localStorage is NOT
 *   updated — so the UI keeps showing the OLD model (e.g. z-ai/glm-5.2)
 *   even though the gateway is actually using the NEW default (e.g.
 *   deepseek-v4-flash-free).
 *
 *   This hook fetches the CURRENT default from /v1/llm/models/default
 *   every 60s. Callers should use this value as the HIGHEST priority
 *   in model resolution chains, above localStorage.
 */

import { useQuery } from '@tanstack/react-query';
import { getEnv } from '@/lib/env-config';

export interface PlatformDefaultModel {
  id: string;
  name?: string;
  provider?: string;
  context_length?: number;
  reasoning?: boolean;
}

const STALE_TIME_MS = 30_000; // 30s — fresh enough for admin changes
const REFETCH_INTERVAL_MS = 60_000; // 1min — periodic refresh

export function usePlatformDefaultModel() {
  return useQuery<PlatformDefaultModel | null>({
    queryKey: ['platform-default-model'],
    queryFn: async () => {
      const backendUrl = getEnv().BACKEND_URL || '/v1';
      const url = `${backendUrl.replace(/\/+$/, '')}/llm/models/default`;
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        if (res.status === 404) return null; // no default configured
        throw new Error(`HTTP ${res.status}`);
      }
      return (await res.json()) as PlatformDefaultModel;
    },
    staleTime: STALE_TIME_MS,
    refetchInterval: REFETCH_INTERVAL_MS,
    retry: 1,
  });
}
