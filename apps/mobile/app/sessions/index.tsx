/**
 * Sessions list screen — shows all user sessions (simple mode, no projects).
 *
 * Design matches the existing ProjectsPage and home.tsx drawer patterns:
 * - Uses PageHeader, PageContent components
 * - Uses Text from @/components/ui/text
 * - Uses theme colors, SafeArea, NativeWind
 * - Ionicons + lucide-react-native icons
 * - Same card/row layout as ProjectsPage
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  ScrollView,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  Text as RNText,
  TouchableOpacity,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { MessageSquare, Clock, ChevronRight, Plus } from 'lucide-react-native';
import { useRouter } from 'expo-router';

import { useSessions, useCreateSession, useDeleteSession } from '@/lib/sessions/hooks';
import { useSessionStore } from '@/stores/session-store';
import { PageHeader } from '@/components/ui/page-header';
import { PageContent } from '@/components/ui/page-content';
import { useThemeColors } from '@/lib/theme-colors';
import { haptics } from '@/lib/haptics';

// ── Helpers ──────────────────────────────────────────────────────────────────

function ago(t?: string | number) {
  if (!t) return '';
  const ms = Date.now() - (typeof t === 'string' ? +new Date(t) : t);
  const m = (ms / 60000) | 0;
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = (m / 60) | 0;
  if (h < 24) return h + 'h ago';
  const d = (h / 24) | 0;
  return d < 30 ? d + 'd ago' : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function statusColor(status: string, isDark: boolean) {
  if (status === 'running') return isDark ? '#4ade80' : '#22c55e';
  if (status === 'provisioning') return isDark ? '#fbbf24' : '#f59e0b';
  if (status === 'stopped' || status === 'archived') return isDark ? '#94a3b8' : '#64748b';
  if (status === 'failed') return isDark ? '#f87171' : '#ef4444';
  return isDark ? '#94a3b8' : '#64748b';
}

// ── Session Row ──────────────────────────────────────────────────────────────

interface SessionRowProps {
  session: {
    session_id: string;
    name: string | null;
    status: string;
    updated_at: string;
    created_at: string;
  };
  onPress: () => void;
  onDelete: () => void;
}

function SessionRow({ session, onPress, onDelete }: SessionRowProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { colors } = useThemeColors();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 0.5,
        borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      }}
    >
      {/* Icon */}
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 12,
        }}
      >
        <MessageSquare
          size={18}
          color={isDark ? 'rgba(248,248,248,0.5)' : 'rgba(18,18,21,0.4)'}
        />
      </View>

      {/* Content */}
      <View style={{ flex: 1, gap: 3 }}>
        <Text
          style={{
            fontSize: 15,
            fontFamily: 'Roobert-Medium',
            color: isDark ? '#f8f8f8' : '#121215',
          }}
          numberOfLines={1}
        >
          {session.name || 'New Session'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: statusColor(session.status, isDark),
            }}
          />
          <Text
            style={{
              fontSize: 12,
              fontFamily: 'Roobert',
              color: isDark ? 'rgba(248,248,248,0.4)' : 'rgba(18,18,21,0.4)',
            }}
          >
            {session.status} · {ago(session.updated_at)}
          </Text>
        </View>
      </View>

      {/* Actions */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TouchableOpacity
          onPress={onDelete}
          hitSlop={6}
          activeOpacity={0.6}
          style={{ padding: 6 }}
        >
          <Ionicons
            name="trash-outline"
            size={16}
            color={isDark ? 'rgba(248,248,248,0.3)' : 'rgba(18,18,21,0.3)'}
          />
        </TouchableOpacity>
        <ChevronRight
          size={18}
          color={isDark ? 'rgba(248,248,248,0.2)' : 'rgba(18,18,21,0.2)'}
        />
      </View>
    </TouchableOpacity>
  );
}

// ── Main Screen ──────────────────────────────────────────────────────────────

export default function SessionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
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

  const handleCreate = useCallback(async () => {
    haptics.medium();
    try {
      const result = await createMut.mutateAsync({ name: 'New Session' });
      setLastSessionId(result.session_id);
      router.push(`/sessions/${result.session_id}`);
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  }, [createMut, setLastSessionId, router]);

  const handleOpen = useCallback((sessionId: string) => {
    haptics.light();
    setLastSessionId(sessionId);
    router.push(`/sessions/${sessionId}`);
  }, [setLastSessionId, router]);

  const handleDelete = useCallback(async (sessionId: string) => {
    haptics.medium();
    try {
      await deleteMut.mutateAsync(sessionId);
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  }, [deleteMut]);

  const sortedSessions = useMemo(() => {
    if (!sessions) return [];
    return [...sessions].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  }, [sessions]);

  return (
    <View style={{ flex: 1, backgroundColor: isDark ? '#09090b' : '#FFFFFF' }}>
      {/* Header */}
      <PageHeader
        title="Sessions"
        onBack={() => router.back()}
        rightAction={
          <TouchableOpacity
            onPress={handleCreate}
            disabled={createMut.isPending}
            activeOpacity={0.7}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
              opacity: createMut.isPending ? 0.5 : 1,
            }}
          >
            {createMut.isPending ? (
              <ActivityIndicator size="small" color={isDark ? '#f8f8f8' : '#121215'} />
            ) : (
              <Plus size={16} color={isDark ? '#f8f8f8' : '#121215'} />
            )}
            <Text
              style={{
                fontSize: 14,
                fontFamily: 'Roobert-Medium',
                color: isDark ? '#f8f8f8' : '#121215',
              }}
            >
              {createMut.isPending ? 'Creating...' : 'New'}
            </Text>
          </TouchableOpacity>
        }
      />

      {/* Content */}
      <PageContent>
        {isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
            <ActivityIndicator size="small" color={isDark ? 'rgba(248,248,248,0.3)' : 'rgba(18,18,21,0.3)'} />
          </View>
        ) : sortedSessions.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 120, paddingHorizontal: 40 }}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <MessageSquare
                size={24}
                color={isDark ? 'rgba(248,248,248,0.2)' : 'rgba(18,18,21,0.2)'}
              />
            </View>
            <Text
              style={{
                fontSize: 16,
                fontFamily: 'Roobert-Medium',
                color: isDark ? 'rgba(248,248,248,0.4)' : 'rgba(18,18,21,0.4)',
              }}
            >
              No sessions yet
            </Text>
            <Text
              style={{
                fontSize: 14,
                fontFamily: 'Roobert',
                color: isDark ? 'rgba(248,248,248,0.25)' : 'rgba(18,18,21,0.25)',
                marginTop: 6,
                textAlign: 'center',
              }}
            >
              Tap "New" to start your first session
            </Text>

            <TouchableOpacity
              onPress={handleCreate}
              disabled={createMut.isPending}
              activeOpacity={0.7}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 20,
                paddingVertical: 12,
                borderRadius: 999,
                backgroundColor: isDark ? '#ffffff' : '#000000',
                marginTop: 24,
                opacity: createMut.isPending ? 0.5 : 1,
              }}
            >
              {createMut.isPending ? (
                <ActivityIndicator size="small" color={isDark ? '#000000' : '#ffffff'} />
              ) : (
                <Plus size={18} color={isDark ? '#000000' : '#ffffff'} />
              )}
              <Text
                style={{
                  fontSize: 15,
                  fontFamily: 'Roobert-SemiBold',
                  color: isDark ? '#000000' : '#ffffff',
                }}
              >
                New Session
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing || isRefetching}
                onRefresh={onRefresh}
                tintColor={isDark ? 'rgba(248,248,248,0.3)' : 'rgba(18,18,21,0.3)'}
              />
            }
          >
            {sortedSessions.map((session) => (
              <SessionRow
                key={session.session_id}
                session={session}
                onPress={() => handleOpen(session.session_id)}
                onDelete={() => handleDelete(session.session_id)}
              />
            ))}
          </ScrollView>
        )}
      </PageContent>
    </View>
  );
}
