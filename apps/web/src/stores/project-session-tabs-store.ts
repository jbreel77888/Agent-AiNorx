/**
 * Project session tabs store — STUB (Phase 7.2.8).
 *
 * The original store managed per-project session tabs (the tab bar in the
 * legacy /projects/[id]/ shell). Session-only mode uses a different tab
 * store (`useTabStore`), so this is now dead code.
 *
 * This stub keeps the `openTab` API surface alive so legacy callers
 * (command-palette) keep compiling. The function is a no-op.
 */

import { useSyncExternalStore } from 'react';

interface ProjectSessionTabsStoreState {
  openTab: (projectId: string, sessionId: string) => void;
  closeTab: (sessionId: string) => void;
}

const stubState: ProjectSessionTabsStoreState = {
  openTab: () => {},
  closeTab: () => {},
};

const subscribe = (_listener: () => void) => () => {};

// The hook: callable with optional selector, plus has `.getState()` attached.
type UseProjectSessionTabsStore = {
  (): ProjectSessionTabsStoreState;
  <T>(selector: (s: ProjectSessionTabsStoreState) => T): T;
  getState(): ProjectSessionTabsStoreState;
  subscribe: typeof subscribe;
};

function useProjectSessionTabsStoreImpl<T>(selector?: (s: ProjectSessionTabsStoreState) => T): T | ProjectSessionTabsStoreState {
  useSyncExternalStore(subscribe, () => stubState, () => stubState);
  return selector ? selector(stubState) : stubState;
}

export const useProjectSessionTabsStore = useProjectSessionTabsStoreImpl as unknown as UseProjectSessionTabsStore;
useProjectSessionTabsStore.getState = () => stubState;
useProjectSessionTabsStore.subscribe = subscribe;
