/**
 * Session detail screen — shows the chat view for a specific session.
 *
 * This is the NEW top-level session detail screen that uses /v1/sessions/*
 * instead of /v1/projects/{id}/sessions/*. It provisions the sandbox,
 * connects to the OpenCode SSE stream, and renders the chat UI.
 */

import { View, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useSessionStartPolling, useSessionHealth } from '@/lib/sessions/hooks';
import { useSessionStore } from '@/stores/session-store';

export default function SessionDetailScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { setLastSessionId } = useSessionStore();

  // Start/resume the session and poll until ready
  const { data: startResult, isLoading: isStarting } = useSessionStartPolling(sessionId);
  const { data: health } = useSessionHealth(
    sessionId,
    startResult?.stage === 'ready'
  );

  useEffect(() => {
    if (sessionId) {
      setLastSessionId(sessionId);
    }
  }, [sessionId, setLastSessionId]);

  // Handle session not found
  if (startResult && 'not_found' in startResult) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-zinc-950">
        <Text className="text-zinc-400 text-base mb-4">Session not found</Text>
        <TouchableOpacity onPress={() => router.replace('/sessions')}>
          <Text className="text-blue-500">Back to Sessions</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Loading state
  if (isStarting || (startResult && startResult.stage !== 'ready')) {
    const stage = startResult?.stage || 'provisioning';
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-zinc-950">
        <ActivityIndicator size="large" />
        <Text className="text-zinc-500 mt-4">
          {stage === 'provisioning' && 'Creating your sandbox...'}
          {stage === 'starting' && 'Starting the agent...'}
          {stage === 'stopped' && 'Resuming your session...'}
          {stage === 'failed' && 'Failed to start. Tap to retry.'}
        </Text>
        {stage === 'failed' && (
          <TouchableOpacity
            onPress={() => router.replace(`/sessions/${sessionId}`)}
            className="mt-4 bg-blue-500 px-4 py-2 rounded-lg"
          >
            <Text className="text-white font-semibold">Retry</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // Ready — show chat
  if (startResult?.stage === 'ready') {
    const sandbox = startResult.sandbox;
    const opencodeSessionId = startResult.opencode_session_id;

    // TODO: Render the actual SessionPage component here
    // For now, show a placeholder that displays the connection info
    return (
      <View className="flex-1 bg-white dark:bg-zinc-950">
        <View className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <Text className="text-lg font-bold text-zinc-900 dark:text-white">
            Session Ready
          </Text>
          <Text className="text-sm text-zinc-500">
            Sandbox: {sandbox?.external_id ?? 'N/A'}
          </Text>
          <Text className="text-sm text-zinc-500">
            OpenCode: {opencodeSessionId ?? 'N/A'}
          </Text>
          <Text className="text-sm text-zinc-500">
            Health: {health?.status ?? 'unknown'}
          </Text>
        </View>
        <View className="flex-1 items-center justify-center">
          <Text className="text-zinc-400">
            Chat UI will be rendered here.
          </Text>
          <Text className="text-zinc-400 text-sm mt-2">
            SessionPage component needs to be updated to accept
            sessionId + sandboxUrl without projectId.
          </Text>
        </View>
      </View>
    );
  }

  // Fallback
  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-zinc-950">
      <ActivityIndicator size="large" />
    </View>
  );
}
