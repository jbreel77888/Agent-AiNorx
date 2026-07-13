/**
 * Sessions list screen — shows all user sessions (simple mode, no projects).
 *
 * This is the NEW top-level sessions screen that replaces the project-scoped
 * sessions list. Users can create, open, and delete sessions directly.
 */

import { View, Text, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useCallback } from 'react';
import { useSessions, useCreateSession, useDeleteSession } from '@/lib/sessions/hooks';
import { useSessionStore } from '@/stores/session-store';
import { useAuth } from '@/hooks/useAuth';

export default function SessionsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: sessions, isLoading, refetch, isRefetching } = useSessions();
  const createMut = useCreateSession();
  const deleteMut = useDeleteSession();
  const { setLastSessionId } = useSessionStore();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleCreateSession = async () => {
    try {
      const result = await createMut.mutateAsync({
        name: 'New Session',
      });
      setLastSessionId(result.session_id);
      router.push(`/sessions/${result.session_id}`);
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  };

  const handleOpenSession = (sessionId: string) => {
    setLastSessionId(sessionId);
    router.push(`/sessions/${sessionId}`);
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await deleteMut.mutateAsync(sessionId);
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-zinc-950">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white dark:bg-zinc-950">
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
        <Text className="text-xl font-bold text-zinc-900 dark:text-white">
          Sessions
        </Text>
        <TouchableOpacity
          onPress={handleCreateSession}
          disabled={createMut.isPending}
          className="bg-blue-500 px-4 py-2 rounded-lg"
        >
          <Text className="text-white font-semibold">
            {createMut.isPending ? 'Creating...' : 'New Session'}
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={sessions ?? []}
        keyExtractor={(item) => item.session_id}
        refreshControl={
          <RefreshControl refreshing={refreshing || isRefetching} onRefresh={onRefresh} />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => handleOpenSession(item.session_id)}
            className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-900"
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-1">
                <Text className="text-base font-semibold text-zinc-900 dark:text-white">
                  {item.name || 'Untitled Session'}
                </Text>
                <Text className="text-sm text-zinc-500 dark:text-zinc-400">
                  {item.status} · {new Date(item.updated_at).toLocaleDateString()}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => handleDeleteSession(item.session_id)}
                className="p-2"
              >
                <Text className="text-red-500">Delete</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center py-20">
            <Text className="text-zinc-400 text-base">No sessions yet</Text>
            <Text className="text-zinc-400 text-sm mt-1">
              Tap "New Session" to get started
            </Text>
          </View>
        }
      />
    </View>
  );
}
