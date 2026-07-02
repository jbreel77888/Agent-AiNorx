'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Loader2, MoreHorizontal, Pencil } from 'lucide-react';
import { useState } from 'react';
import { createSession, deleteSession, listSessions, renameSession, type SimpleSession } from '@/lib/sessions-client';
import { markSessionFresh } from '@/lib/fresh-sessions';
import { cn } from '@/lib/utils';
import { useParams } from 'next/navigation';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/lib/toast';

// Status → dot color + tooltip
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

export function SimpleSessionList() {
  const router = useRouter();
  const params = useParams();
  const queryClient = useQueryClient();
  const activeSessionId = params?.sessionId as string | undefined;

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data: sessions, isLoading } = useQuery<SimpleSession[]>({
    queryKey: ['sessions'],
    queryFn: listSessions,
    refetchOnWindowFocus: true,
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
  });

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => deleteSession(sessionId),
    onMutate: (sessionId) => {
      // Optimistic remove from cache
      setDeletingId(sessionId);
      const prev = queryClient.getQueryData<SimpleSession[]>(['sessions']);
      queryClient.setQueryData<SimpleSession[]>(
        ['sessions'],
        (old) => (old ?? []).filter((s) => s.session_id !== sessionId),
      );
      return { prev };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast.success('Session deleted');
    },
    onError: (err, _vars, ctx) => {
      // Rollback
      if (ctx?.prev) queryClient.setQueryData(['sessions'], ctx.prev);
      toast.error(err instanceof Error ? err.message : 'Failed to delete session');
    },
    onSettled: () => setDeletingId(null),
  });

  const renameMutation = useMutation({
    mutationFn: ({ sessionId, name }: { sessionId: string; name: string }) =>
      renameSession(sessionId, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast.success('Renamed');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Rename failed'),
  });

  const handleConfirmDelete = () => {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    if (activeSessionId === id) router.push('/sessions');
    deleteMutation.mutate(id);
  };

  return (
    <div className="flex h-full flex-col">
      {/* New Session button */}
      <div className="p-2">
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
        >
          {createMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          New Session
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {isLoading ? (
          <div className="text-muted-foreground p-2 text-xs">Loading...</div>
        ) : !sessions || sessions.length === 0 ? (
          <div className="text-muted-foreground p-2 text-xs">No sessions yet</div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {sessions.map((session) => {
              const visual = statusVisual(session.status);
              const isActive = activeSessionId === session.session_id;
              const isThisDeleting = deletingId === session.session_id;

              return (
                <div
                  key={session.session_id}
                  className={cn(
                    'group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    isThisDeleting && 'opacity-40 pointer-events-none',
                  )}
                  onClick={() => router.push(`/sessions/${session.session_id}`)}
                >
                  {/* Status dot — visible always so users can see suspended/failed state */}
                  <span
                    className={cn('h-1.5 w-1.5 shrink-0 rounded-full', visual.color, visual.pulse && 'animate-pulse')}
                    title={visual.label}
                  />

                  {/* Title or rename input */}
                  {renamingId === session.session_id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={() => {
                        if (renameValue.trim() && renameValue !== session.name) {
                          renameMutation.mutate({ sessionId: session.session_id, name: renameValue.trim() });
                        }
                        setRenamingId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          (e.target as HTMLInputElement).blur();
                        } else if (e.key === 'Escape') {
                          setRenamingId(null);
                        }
                      }}
                      className="flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-sm"
                    />
                  ) : (
                    <span className="flex-1 truncate">{session.name || 'Untitled'}</span>
                  )}

                  {/* Loading spinner while deleting this row */}
                  {isThisDeleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                          className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                          aria-label="Session actions"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingId(session.session_id);
                            setRenameValue(session.name || '');
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(session.session_id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={confirmDeleteId !== null} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will terminate the sandbox and remove all session files. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
