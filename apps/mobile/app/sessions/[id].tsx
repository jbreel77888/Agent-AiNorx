/**
 * Session detail screen — chat view for a specific session.
 *
 * Design matches the existing home.tsx connecting/loading states:
 * - Uses KortixLogo, ActivityIndicator, theme colors
 * - Same "Connecting to Workspace" pattern as home.tsx
 * - Uses Text from @/components/ui/text (Roobert font family)
 * - Haptic feedback on actions
 */

import React, { useEffect, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { useColorScheme } from 'nativewind';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSessionStartPolling, useSessionHealth, useRestartSession } from '@/lib/sessions/hooks';
import { useSessionStore } from '@/stores/session-store';
import { KortixLogo } from '@/components/ui/KortixLogo';
import { haptics } from '@/lib/haptics';
import type { SessionStartResult } from '@/lib/sessions/types';

export default function SessionDetailScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { setLastSessionId } = useSessionStore();

  const { data: startResult, isLoading: isStarting } = useSessionStartPolling(sessionId);
  const { data: health } = useSessionHealth(
    sessionId,
    startResult?.stage === 'ready'
  );
  const restartMut = useRestartSession();

  useEffect(() => {
    if (sessionId) {
      setLastSessionId(sessionId);
    }
  }, [sessionId, setLastSessionId]);

  const handleRestart = useCallback(async () => {
    if (!sessionId || restartMut.isPending) return;
    haptics.medium();
    try {
      await restartMut.mutateAsync(sessionId);
      Alert.alert('Restarting', 'Session restart initiated. Reconnecting…');
    } catch (err: any) {
      Alert.alert('Restart failed', err?.message || 'Unknown error');
    }
  }, [sessionId, restartMut]);

  // Session not found
  if (startResult && 'not_found' in startResult) {
    return (
      <View style={[styles.container, { backgroundColor: isDark ? '#09090b' : '#FFFFFF' }]}>
        <View style={styles.centerContent}>
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={isDark ? 'rgba(248,248,248,0.2)' : 'rgba(18,18,21,0.2)'}
          />
          <Text style={styles.mutedText(isDark)}>
            Session not found
          </Text>
          <TouchableOpacity
            onPress={() => router.replace('/sessions')}
            activeOpacity={0.7}
            style={styles.button(isDark)}
          >
            <Text style={styles.buttonText(isDark)}>Back to Sessions</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Loading / provisioning
  if (isStarting || !startResult || (startResult.stage !== 'ready' && startResult.stage !== 'failed')) {
    const stage = startResult?.stage || 'provisioning';
    const phaseText =
      stage === 'provisioning'
        ? 'Creating your sandbox...'
        : stage === 'starting'
        ? 'Starting the agent...'
        : stage === 'stopped'
        ? 'Resuming your session...'
        : 'Connecting to Workspace';

    return (
      <View style={[styles.container, { backgroundColor: isDark ? '#09090b' : '#FFFFFF' }]}>
        <View style={styles.centerContent}>
          {/* Logo + label */}
          <View style={{ alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <KortixLogo size={22} variant="symbol" color={isDark ? 'dark' : 'light'} />
            <Text
              style={{
                fontSize: 13,
                fontFamily: 'Roobert',
                letterSpacing: 2,
                textTransform: 'uppercase',
                color: isDark ? 'rgba(248,248,248,0.3)' : 'rgba(18,18,21,0.3)',
              }}
            >
              Connecting to Workspace
            </Text>
          </View>

          <ActivityIndicator
            size="small"
            color={isDark ? '#ffffff' : '#000000'}
          />

          <Text
            style={{
              marginTop: 24,
              fontSize: 14,
              fontFamily: 'Roobert',
              color: isDark ? 'rgba(248,248,248,0.4)' : 'rgba(18,18,21,0.4)',
              textAlign: 'center',
              lineHeight: 22,
              maxWidth: 300,
            }}
          >
            {phaseText}
          </Text>
        </View>
      </View>
    );
  }

  // Failed
  if (startResult.stage === 'failed') {
    return (
      <View style={[styles.container, { backgroundColor: isDark ? '#09090b' : '#FFFFFF' }]}>
        <View style={styles.centerContent}>
          <Ionicons
            name="warning-outline"
            size={48}
            color={isDark ? '#f87171' : '#ef4444'}
          />
          <Text
            style={{
              marginTop: 16,
              fontSize: 16,
              fontFamily: 'Roobert-Medium',
              color: isDark ? '#f8f8f8' : '#121215',
            }}
          >
            Failed to start session
          </Text>
          <Text
            style={{
              marginTop: 8,
              fontSize: 14,
              fontFamily: 'Roobert',
              color: isDark ? 'rgba(248,248,248,0.4)' : 'rgba(18,18,21,0.4)',
              textAlign: 'center',
              maxWidth: 280,
            }}
          >
            {startResult.reason || 'An error occurred while provisioning the sandbox.'}
          </Text>

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 24 }}>
            <TouchableOpacity
              onPress={handleRestart}
              disabled={restartMut.isPending}
              activeOpacity={0.7}
              style={styles.pillButton(isDark)}
            >
              {restartMut.isPending ? (
                <ActivityIndicator size="small" color={isDark ? 'rgba(248,248,248,0.6)' : 'rgba(18,18,21,0.5)'} />
              ) : (
                <Ionicons
                  name="refresh-outline"
                  size={14}
                  color={isDark ? 'rgba(248,248,248,0.6)' : 'rgba(18,18,21,0.5)'}
                />
              )}
              <Text style={styles.pillText(isDark)}>
                {restartMut.isPending ? 'Restarting…' : 'Restart'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.replace('/sessions')}
              activeOpacity={0.7}
              style={styles.pillButton(isDark)}
            >
              <Text style={styles.pillText(isDark)}>Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // Ready — sandbox is provisioned
  const sandbox = (startResult as SessionStartResult).sandbox;
  const opencodeSessionId = (startResult as SessionStartResult).opencode_session_id;

  // TODO: Replace with the actual SessionPage component once it's updated
  // to accept sessionId + sandboxUrl without projectId.
  // For now, show a success state with connection info.
  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#09090b' : '#FFFFFF' }]}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 12,
          borderBottomWidth: 0.5,
          borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons
            name="chevron-back"
            size={24}
            color={isDark ? '#f8f8f8' : '#121215'}
          />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 16,
              fontFamily: 'Roobert-SemiBold',
              color: isDark ? '#f8f8f8' : '#121215',
            }}
            numberOfLines={1}
          >
            Session
          </Text>
          <Text
            style={{
              fontSize: 12,
              fontFamily: 'Roobert',
              color: isDark ? 'rgba(248,248,248,0.4)' : 'rgba(18,18,21,0.4)',
            }}
            numberOfLines={1}
          >
            {sandbox?.external_id ?? 'N/A'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: health?.runtimeReady ? (isDark ? '#4ade80' : '#22c55e') : (isDark ? '#fbbf24' : '#f59e0b'),
            }}
          />
          <Text
            style={{
              fontSize: 12,
              fontFamily: 'Roobert',
              color: isDark ? 'rgba(248,248,248,0.4)' : 'rgba(18,18,21,0.4)',
            }}
          >
            {health?.runtimeReady ? 'Ready' : 'Starting...'}
          </Text>
        </View>
      </View>

      {/* Body — placeholder until SessionPage is wired */}
      <View style={styles.centerContent}>
        <KortixLogo size={32} variant="symbol" color={isDark ? 'dark' : 'light'} />
        <Text
          style={{
            marginTop: 16,
            fontSize: 16,
            fontFamily: 'Roobert-Medium',
            color: isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.5)',
          }}
        >
          Session Ready
        </Text>
        <Text
          style={{
            marginTop: 8,
            fontSize: 13,
            fontFamily: 'Roobert',
            color: isDark ? 'rgba(248,248,248,0.25)' : 'rgba(18,18,21,0.25)',
            textAlign: 'center',
            maxWidth: 280,
          }}
        >
          Chat UI will be rendered here once SessionPage is updated to work without projectId.
        </Text>
        <Text
          style={{
            marginTop: 4,
            fontSize: 12,
            fontFamily: 'Roobert',
            color: isDark ? 'rgba(248,248,248,0.15)' : 'rgba(18,18,21,0.15)',
          }}
        >
          OpenCode: {opencodeSessionId ?? 'N/A'}
        </Text>
      </View>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  mutedText: (isDark: boolean) => ({
    fontSize: 16,
    fontFamily: 'Roobert-Medium',
    color: isDark ? 'rgba(248,248,248,0.4)' : 'rgba(18,18,21,0.4)',
    marginTop: 16,
  }),
  button: (isDark: boolean) => ({
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    marginTop: 20,
  }),
  buttonText: (isDark: boolean) => ({
    fontSize: 14,
    fontFamily: 'Roobert-Medium',
    color: isDark ? 'rgba(248,248,248,0.6)' : 'rgba(18,18,21,0.5)',
  }),
  pillButton: (isDark: boolean) => ({
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  }),
  pillText: (isDark: boolean) => ({
    fontSize: 13,
    fontFamily: 'Roobert-Medium',
    color: isDark ? 'rgba(248,248,248,0.6)' : 'rgba(18,18,21,0.5)',
  }),
});
