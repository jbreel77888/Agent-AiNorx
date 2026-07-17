/**
 * Session store — replaces selected-project-store for simple-mode.
 *
 * In simple mode, sessions don't require a project. This store tracks:
 *   - The last opened session ID (for quick resume)
 *   - Whether a new session is being created
 *
 * No project selection needed — sessions are created at the top level.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface SessionStore {
  /** Last opened session ID — used for quick resume on app launch. */
  lastSessionId: string | null;
  /** Set when a new session is being created (optimistic UI). */
  pendingSessionId: string | null;
  /** Set the last opened session. */
  setLastSessionId: (id: string | null) => void;
  /** Set the pending session (during creation). */
  setPendingSessionId: (id: string | null) => void;
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      lastSessionId: null,
      pendingSessionId: null,
      setLastSessionId: (id) => set({ lastSessionId: id }),
      setPendingSessionId: (id) => set({ pendingSessionId: id }),
    }),
    {
      name: 'session-store-v1',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

/**
 * Backward compatibility — old code that imports useSelectedProjectStore
 * will get a no-op store that always returns null projectId.
 * This allows gradual migration without breaking existing screens.
 */
export const useSelectedProjectStore = create<{
  projectId: string | null;
  setProjectId: (id: string | null) => void;
}>()(
  persist(
    (set) => ({
      projectId: null,
      setProjectId: () => set({ projectId: null }), // no-op in simple mode
    }),
    {
      name: 'selected-project-v1',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
