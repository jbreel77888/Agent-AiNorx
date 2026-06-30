'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { EntityAvatar } from '@/components/ui/entity-avatar';
import { Input } from '@/components/ui/input';
import { SectionCard } from '@/components/ui/section-card';
import { Skeleton } from '@/components/ui/skeleton';
import { Icon } from '@/features/icon/icon';
import { AppHeader } from '@/features/layout/app-header';
import { useAuth } from '@/features/providers/auth-provider';
import {
  createSession,
  deleteSession,
  listSessions,
  type SimpleSession,
} from '@/lib/sessions-client';
import { useCurrentAccountStore } from '@/stores/current-account-store';
import { Search, Plus, Trash2, MessageSquare } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { errorToast, successToast } from '@/components/ui/toast';

export default function SessionsPage() {
  const tI18nHardcoded = useTranslations('hardcodedUi');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();
  const { selectedAccountId } = useCurrentAccountStore();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth');
  }, [authLoading, user, router]);

  const { data: sessions, isLoading } = useQuery<SimpleSession[]>({
    queryKey: ['sessions', selectedAccountId],
    queryFn: listSessions,
    enabled: !!user,
  });

  const createMutation = useMutation({
    mutationFn: () => createSession({ name: 'New Session' }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      router.push(`/sessions/${data.session_id}`);
    },
    onError: () => errorToast('Failed to create session'),
  });

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => deleteSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      successToast('Session deleted');
    },
    onError: () => errorToast('Failed to delete session'),
  });

  const filtered = sessions?.filter(s =>
    s.name.toLowerCase().includes(query.toLowerCase())
  ) ?? [];

  return (
    <div className="flex h-full w-full flex-col">
      <AppHeader />
      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-foreground text-2xl font-semibold tracking-tight">
                Sessions
              </h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Your standalone AI agent sessions
              </p>
            </div>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              New Session
            </Button>
          </div>

          {/* Search */}
          <div className="relative max-w-md">
            <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input
              placeholder="Search sessions..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Sessions grid */}
          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<MessageSquare className="h-8 w-8" />}
              title={query ? 'No sessions found' : 'No sessions yet'}
              description={
                query
                  ? 'Try a different search term'
                  : 'Create your first session to get started'
              }
              action={
                !query && (
                  <Button
                    onClick={() => createMutation.mutate()}
                    disabled={createMutation.isPending}
                    className="gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Create Session
                  </Button>
                )
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((session) => (
                <SectionCard
                  key={session.session_id}
                  className="group cursor-pointer transition-shadow hover:shadow-md"
                  onClick={() => router.push(`/sessions/${session.session_id}`)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <EntityAvatar
                        name={session.name}
                        size="md"
                      />
                      <div>
                        <h3 className="text-foreground font-medium">
                          {session.name}
                        </h3>
                        <p className="text-muted-foreground text-xs">
                          {new Date(session.updated_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteMutation.mutate(session.session_id);
                      }}
                      className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        session.status === 'running'
                          ? 'bg-green-500/10 text-green-600'
                          : session.status === 'provisioning'
                            ? 'bg-yellow-500/10 text-yellow-600'
                            : session.status === 'failed'
                              ? 'bg-red-500/10 text-red-600'
                              : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {session.status}
                    </span>
                  </div>
                </SectionCard>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
