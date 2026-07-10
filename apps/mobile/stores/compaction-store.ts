/**
 * Compaction store — tracks which sessions are currently being compacted.
 * Mirrors the frontend's opencode-compaction-store.ts.
 */

import { create } from 'zustand';

interface CompactionState {
  compactingBySession: Record<string, boolean>;
  startCompaction: (sessionId: string) => void;
  stopCompaction: (sessionId: string) => void;
  clear: () => void;
}

export const useCompactionStore = create<CompactionState>()((set) => ({
  compactingBySession: {},
  startCompaction: (sessionId) =>
    set((state) => {
      if (state.compactingBySession[sessionId]) return state;
      return {
        compactingBySession: {
          ...state.compactingBySession,
          [sessionId]: true,
        },
      };
    }),
  stopCompaction: (sessionId) =>
    set((state) => {
      if (!(sessionId in state.compactingBySession)) return state;
      const { [sessionId]: _, ...rest } = state.compactingBySession;
      return { compactingBySession: rest };
    }),
  clear: () =>
    set((state) => {
      if (Object.keys(state.compactingBySession).length === 0) return state;
      return { compactingBySession: {} };
    }),
}));
