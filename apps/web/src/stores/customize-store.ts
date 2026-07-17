/**
 * Customize store — STUB (Phase 7.2.8).
 *
 * The original customize store managed the full-screen Customize overlay for
 * project-scoped sections (agents, skills, connectors, secrets, …). With
 * session-only mode, there's no Customize overlay anymore.
 *
 * This stub keeps the `openCustomize` API surface alive so legacy callers
 * (command-palette) keep compiling. The function is a no-op.
 */

import { useSyncExternalStore } from 'react';

export type CustomizeSection =
  | 'changes'
  | 'files'
  | 'skills'
  | 'agents'
  | 'commands'
  | 'marketplace'
  | 'secrets'
  | 'connectors'
  | 'computers'
  | 'members'
  | 'schedules'
  | 'webhooks'
  | 'channels'
  | 'sandbox'
  | 'dev'
  | 'settings';

interface CustomizeStoreState {
  isOpen: boolean;
  section: CustomizeSection | null;
  openCustomize: (section?: CustomizeSection) => void;
  closeCustomize: () => void;
}

const stubState: CustomizeStoreState = {
  isOpen: false,
  section: null,
  openCustomize: () => {},
  closeCustomize: () => {},
};

const subscribe = (_listener: () => void) => () => {};

type UseCustomizeStore = {
  (): CustomizeStoreState;
  <T>(selector: (s: CustomizeStoreState) => T): T;
  getState(): CustomizeStoreState;
  subscribe: typeof subscribe;
};

function useCustomizeStoreImpl<T>(selector?: (s: CustomizeStoreState) => T): T | CustomizeStoreState {
  useSyncExternalStore(subscribe, () => stubState, () => stubState);
  return selector ? selector(stubState) : stubState;
}

export const useCustomizeStore = useCustomizeStoreImpl as unknown as UseCustomizeStore;
useCustomizeStore.getState = () => stubState;
useCustomizeStore.subscribe = subscribe;
