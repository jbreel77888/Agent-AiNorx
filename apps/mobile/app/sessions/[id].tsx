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
import { useSandboxContext } from '@/contexts/SandboxContext';
import { KortixLogo } from '@/components/ui/KortixLogo';
import { haptics } from '@/lib/haptics';
import { getSandboxUrl } from '@/lib/platform/client';
import type { SessionStartResult } from '@/lib/sessions/types';
import { SessionPage } from '@/components/session/SessionPage';

export default function SessionDetailScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { setLastSessionId } = useSessionStore();
  const { switchSandbox, sandboxUrl: activeSandboxUrl } = useSandboxContext();

  const { data: startResult, isLoading: isStarting } = useSessionStartPolling(sessionId);
  const isReady = startResult && !('not_found' in startResult) && startResult.stage === 'ready';
  const { data: health } = useSessionHealth(
    sessionId,
    isReady
  );
  const restartMut = useRestartSession();

  useEffect(() => {
    if (sessionId) {
      setLastSessionId(sessionId);
    }
  }, [sessionId, setLastSessionId]);

  // When the session becomes ready, switch the global SandboxContext to point
  // at this session's sandbox so SessionPage (which reads sandboxUrl from
  // context) can connect to the right sandbox.
  useEffect(() => {
    if (!startResult || 'not_found' in startResult) return;
    if (startResult.stage !== 'ready') return;
    const sandbox = (startResult as SessionStartResult).sandbox;
    if (!sandbox?.external_id) return;
    const expectedUrl = getSandboxUrl(sandbox.external_id);
    // Only switch if we're not already pointing at this sandbox (avoids loops).
    if (activeSandboxUrl !== expectedUrl) {
      switchSandbox({
        external_id: sandbox.external_id,
        sandbox_id: sandbox.sandbox_id,
        name: 'Session',
      } as any);
    }
  }, [startResult, switchSandbox, activeSandboxUrl]);

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
          <Text style={[styles.mutedText, { color: isDark ? "rgba(248,248,248,0.4)" : "rgba(18,18,21,0.4)" }]}>
            Session not found
          </Text>
          <TouchableOpacity
            onPress={() => router.replace('/sessions')}
            activeOpacity={0.7}
            style={[styles.button, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" }]}
          >
            <Text style={[styles.buttonText, { color: isDark ? "rgba(248,248,248,0.6)" : "rgba(18,18,21,0.5)" }]}>Back to Sessions</Text>
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
              style={[styles.pillButton, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" }]}
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
              <Text style={[styles.pillText, { color: isDark ? "rgba(248,248,248,0.6)" : "rgba(18,18,21,0.5)" }]}>
                {restartMut.isPending ? 'Restarting…' : 'Restart'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.replace('/sessions')}
              activeOpacity={0.7}
              style={[styles.pillButton, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" }]}
            >
              <Text style={[styles.pillText, { color: isDark ? "rgba(248,248,248,0.6)" : "rgba(18,18,21,0.5)" }]}>Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // Ready — sandbox is provisioned. Render the full SessionPage (chat UI).
  // The SandboxContext has been switched (via the useEffect above) to point
  // at this session's sandbox, so SessionPage can read sandboxUrl from context.
  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#09090b' : '#FFFFFF' }]}>
      <SessionPage
        sessionId={sessionId}
        onBack={() => router.replace('/sessions')}
        onOpenDrawer={() => {}}
        onOpenRightDrawer={() => {}}
        isDrawerOpen={false}
        isRightDrawerOpen={false}
      />
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
  mutedText: {
    fontSize: 16,
    fontFamily: 'Roobert-Medium',
    marginTop: 16,
  },
  button: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    marginTop: 20,
  },
  buttonText: {
    fontSize: 14,
    fontFamily: 'Roobert-Medium',
  },
  pillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 13,
    fontFamily: 'Roobert-Medium',
  },
});
