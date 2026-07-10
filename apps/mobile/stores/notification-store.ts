import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface NotificationPreferences {
  enabled: boolean;
  onCompletion: boolean;
  onError: boolean;
  onQuestion: boolean;
  onPermission: boolean;
  playSound: boolean;
}

interface NotificationState {
  preferences: NotificationPreferences;
  setPreference: <K extends keyof NotificationPreferences>(
    key: K,
    value: NotificationPreferences[K],
  ) => void;
  toggleEnabled: () => void;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: true,
  onCompletion: true,
  onError: true,
  onQuestion: true,
  onPermission: true,
  playSound: true,
};

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
      preferences: DEFAULT_PREFERENCES,

      setPreference: (key, value) => {
        set((state) => ({
          preferences: { ...state.preferences, [key]: value },
        }));
      },

      toggleEnabled: () => {
        set((state) => ({
          preferences: { ...state.preferences, enabled: !state.preferences.enabled },
        }));
      },
    }),
    {
      name: '@notification_preferences',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        preferences: state.preferences,
      }),
    },
  ),
);
