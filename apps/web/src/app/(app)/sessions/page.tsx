'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/features/providers/auth-provider';
import { createSession, listSessions, deleteSession, type SimpleSession } from '@/lib/sessions-client';
import { markSessionFresh } from '@/lib/fresh-sessions';
import {
  Plus,
  Sparkles,
  Rocket,
  MessageSquare,
  BrainCircuit,
  FolderOpen,
  Search,
  Trash2,
  Loader2,
  Clock,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';

// Status → dot color + label
function statusVisual(status: string): { color: string; label: string; pulse?: boolean } {
  switch (status) {
    case 'running':
      return { color: 'bg-emerald-500', label: 'Running' };
    case 'provisioning':
    case 'queued':
    case 'branching':
      return { color: 'bg-amber-500', label: 'Provisioning', pulse: true };
    case 'suspended':
    case 'stopped':
      return { color: 'bg-muted-foreground/40', label: 'Suspended' };
    case 'failed':
    case 'error':
      return { color: 'bg-red-500', label: 'Failed' };
    case 'completed':
      return { color: 'bg-blue-500', label: 'Completed' };
    default:
      return { color: 'bg-muted-foreground/30', label: status || 'Unknown' };
  }
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

const FEATURES = [
  {
    icon: Rocket,
    title: 'Instant Sandbox',
    description: 'A fully-isolated sandbox spins up in seconds. No setup, no configuration — just start chatting.',
    color: 'text-orange-500',
    bg: 'bg-orange-500/10',
  },
  {
    icon: MessageSquare,
    title: 'Real-time Streaming',
    description: 'Token-by-token streaming responses from the VaelorX agent with full Markdown rendering.',
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
  },
  {
    icon: BrainCircuit,
    title: 'Agent Memory',
    description: 'The agent remembers context within each session and learns your workflow over time.',
    color: 'text-purple-500',
    bg: 'bg-purple-500/10',
  },
  {
    icon: FolderOpen,
    title: 'File Management',
    description: 'Upload, edit, and manage files directly in your sandbox workspace. Full filesystem access.',
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
  },
] as const;

export default function SessionsPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data: sessions, isLoading: sessionsLoading } = useQuery<SimpleSession[]>({
    queryKey: ['sessions'],
    queryFn: listSessions,
    enabled: !!user,
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const sessionId = crypto.randomUUID();
      markSessionFresh(sessionId);
      router.push(`/sessions/${sessionId}`);
      return createSession({ name: 'New Session', session_id: sessionId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create session');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => deleteSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast.success('Session deleted');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete session');
    },
  });

  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth');
  }, [authLoading, user, router]);

  // NOTE: NO auto-redirect to most recent session — the user explicitly asked
  // for the welcome page to stay visible. Sessions are reachable via the
  // "Recent sessions" list below or via the sidebar.

  const filteredSessions = useMemo(() => {
    if (!sessions) return [];
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter(
      (s) =>
        (s.name || 'Untitled').toLowerCase().includes(q) ||
        s.status.toLowerCase().includes(q),
    );
  }, [sessions, searchQuery]);

  const handleConfirmDelete = () => {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    deleteMutation.mutate(id);
  };

  if (authLoading || !user) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  const hasSessions = (sessions?.length ?? 0) > 0;

  return (
    <div className="bg-background flex h-full w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-10 sm:py-16">
        {/* Hero section */}
        <div className="flex flex-col items-center text-center">
          {/* Logo */}
          <div className="bg-primary/10 mb-6 flex h-20 w-20 items-center justify-center rounded-3xl shadow-sm ring-1 ring-primary/20">
            <Sparkles className="text-primary h-10 w-10" />
          </div>

          {/* Title */}
          <h1 className="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">
            Welcome to VaelorX
          </h1>
          <p className="text-muted-foreground mt-3 max-w-xl text-sm leading-relaxed sm:text-base">
            Your AI-powered workspace by Digital Planetx. Create a session to
            start chatting with your intelligent agent — no setup required.
          </p>

          {/* CTA */}
          <div className="mt-6">
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              size="lg"
              className="gap-2 shadow-lg transition-all hover:shadow-xl"
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              New Session
            </Button>
          </div>
        </div>

        {/* Features grid */}
        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="border-border/60 bg-card/50 hover:border-border hover:bg-card flex flex-col gap-3 rounded-xl border p-5 transition-all"
              >
                <div
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-lg',
                    feature.bg,
                  )}
                >
                  <Icon className={cn('h-5 w-5', feature.color)} />
                </div>
                <div>
                  <h3 className="text-foreground text-sm font-semibold">
                    {feature.title}
                  </h3>
                  <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Recent sessions list */}
        {hasSessions && (
          <div className="mt-12">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-foreground text-lg font-semibold">
                  Recent sessions
                </h2>
                <p className="text-muted-foreground text-xs">
                  {sessions?.length ?? 0} session{(sessions?.length ?? 0) === 1 ? '' : 's'} total
                </p>
              </div>
              {/* Search */}
              <div className="relative w-full max-w-xs">
                <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
                <Input
                  placeholder="Search sessions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            {sessionsLoading ? (
              <div className="border-border/60 divide-border/60 divide-y rounded-xl border">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 p-4">
                    <div className="bg-muted h-9 w-9 animate-pulse rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <div className="bg-muted h-4 w-1/3 animate-pulse rounded" />
                      <div className="bg-muted h-3 w-1/4 animate-pulse rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="text-muted-foreground border-border/60 rounded-xl border border-dashed p-8 text-center text-sm">
                No sessions match "{searchQuery}"
              </div>
            ) : (
              <div className="border-border/60 divide-border/60 bg-card/30 overflow-hidden rounded-xl border divide-y">
                {filteredSessions.slice(0, 20).map((session) => {
                  const visual = statusVisual(session.status);
                  return (
                    <div
                      key={session.session_id}
                      onClick={() => router.push(`/sessions/${session.session_id}`)}
                      className="hover:bg-accent/50 group flex cursor-pointer items-center gap-3 p-4 transition-colors"
                    >
                      {/* Status icon */}
                      <div className="bg-muted/50 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg">
                        <MessageSquare className="text-muted-foreground h-4 w-4" />
                      </div>

                      {/* Name + meta */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-foreground truncate text-sm font-medium">
                            {session.name || 'Untitled'}
                          </span>
                          <span
                            className={cn(
                              'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                              visual.color,
                              visual.pulse && 'animate-pulse',
                            )}
                            title={visual.label}
                          />
                        </div>
                        <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
                          <Clock className="h-3 w-3" />
                          <span>{formatRelativeTime(session.updated_at)}</span>
                          <span aria-hidden>·</span>
                          <span className="capitalize">{visual.label}</span>
                        </div>
                      </div>

                      {/* Delete button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(session.session_id);
                        }}
                        className="text-muted-foreground hover:text-destructive opacity-0 transition-opacity hover:bg-destructive/10 rounded-md p-1.5 group-hover:opacity-100"
                        aria-label="Delete session"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
                {filteredSessions.length > 20 && (
                  <div className="text-muted-foreground p-3 text-center text-xs">
                    Showing 20 of {filteredSessions.length} — use the sidebar to see more
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer hint */}
        {!hasSessions && (
          <div className="text-muted-foreground/70 mt-12 text-center text-xs">
            Tip: Press <kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono text-[10px]">⌘J</kbd> or{' '}
            <kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono text-[10px]">Ctrl+J</kbd> to start a new session from anywhere.
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={confirmDeleteId !== null}
        onOpenChange={(o) => !o && setConfirmDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will terminate the sandbox and remove all session files. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                handleConfirmDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
