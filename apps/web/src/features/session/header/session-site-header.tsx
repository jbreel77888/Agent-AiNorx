'use client';

import { useTranslations } from 'next-intl';

import { sessionDisplayLabel } from '@/features/session/session-label';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Hint from '@/components/ui/hint';
import { Input } from '@/components/ui/input';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import Loading from '@/components/ui/loading';
import { errorToast, successToast } from '@/components/ui/toast';
import { RenameSessionModal } from '@/features/session/modals/rename-session-modal';
import { SessionDeleteModal } from '@/features/session/modals/session-delete-modal';
import { ShareSessionModal } from '@/features/session/modals/share-session-modal';
import { CompactModal } from '@/features/session/header/compact-modal';
import { ExportTranscriptModal } from '@/features/session/header/export-transcript-modal';
import { SessionChangesIndicator } from '@/features/session/header/session-changes-indicator';
import { listProjectSessions, restartProjectSession } from '@/lib/projects-client';
import { deleteSession, renameSession, restartSession } from '@/lib/sessions-client';
import { cn } from '@/lib/utils';
import { opencodeKeys } from '@/hooks/opencode/use-opencode-sessions';
import { useTabStore } from '@/stores/tab-store';
import { Pencil, Share, TrashSolid } from '@mynaui/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, Layers, MoreHorizontal, PanelRight, RotateCcw } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

interface SessionSiteHeaderProps {
  sessionId: string;
  sessionTitle: string;
  onToggleSidePanel: () => void;
  isSidePanelOpen?: boolean;
  isMobileView?: boolean;
  leadingAction?: React.ReactNode;
}

export function SessionSiteHeader({
  sessionId,
  sessionTitle,
  onToggleSidePanel,
  isSidePanelOpen = false,
  isMobileView,
  leadingAction,
}: SessionSiteHeaderProps) {
  const tI18nHardcoded = useTranslations('hardcodedUi');
  const tHardcodedUi = useTranslations('hardcodedUi');
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [exportOpen, setExportOpen] = useState(false);
  const [compactOpen, setCompactOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Simple mode dialogs (replace browser prompt()/confirm())
  const [simpleRenameOpen, setSimpleRenameOpen] = useState(false);
  const [simpleDeleteOpen, setSimpleDeleteOpen] = useState(false);

  // Lifecycle actions (Share / Restart / Delete) operate on the project-level
  // session, which is only addressable on the `/projects/:id/sessions/:id` route.
  const projectRoute = pathname?.match(/^\/projects\/([^/]+)\/sessions\/([^/]+)/);
  const projectId = projectRoute?.[1];
  const projectSessionId = projectRoute?.[2];
  const isProjectSession = !!projectId && !!projectSessionId;

  // Simple mode: detect /sessions/:sessionId route (no project)
  const simpleRoute = pathname?.match(/^\/sessions\/([^/]+)/);
  const simpleSessionId = simpleRoute?.[1];
  const isSimpleSession = !isProjectSession && !!simpleSessionId;

  const { data: projectSessions } = useQuery({
    queryKey: ['project-sessions', projectId],
    queryFn: () => listProjectSessions(projectId!),
    enabled: isProjectSession,
    staleTime: 10_000,
  });
  const projectSession = projectSessions?.find((s) => s.session_id === projectSessionId) ?? null;
  const canShare = !!projectSession && projectSession.can_manage_sharing !== false;

  const restartMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      if (isSimpleSession) {
        await restartSession(simpleSessionId!);
        return;
      }
      await restartProjectSession(projectId!, projectSessionId!);
    },
    onSuccess: () => {
      successToast('Restarting session…');
      if (isProjectSession) {
        queryClient.invalidateQueries({ queryKey: ['project-sessions', projectId] });
      }
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err) => {
      errorToast(err instanceof Error ? err.message : 'Failed to restart session');
    },
  });

  // Simple mode: inline rename + delete (no modal needed)
  const simpleDeleteMutation = useMutation({
    mutationFn: () => deleteSession(simpleSessionId!),
    onSuccess: () => {
      successToast('Session deleted');
      // Full cache cleanup so stale sessions don't linger in the sidebar
      // or the active tab store.
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: opencodeKeys.sessions() });
      // Close the deleted session's tab so the user lands on /sessions
      try {
        useTabStore.getState().closeTab(simpleSessionId!);
      } catch {}
      router.push('/sessions');
    },
    onError: (err) => {
      errorToast(err instanceof Error ? err.message : 'Failed to delete session');
    },
  });

  const [simpleRenameValue, setSimpleRenameValue] = useState('');
  const simpleRenameMutation = useMutation({
    mutationFn: (name: string) => renameSession(simpleSessionId!, name),
    onSuccess: () => {
      successToast('Session renamed');
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setRenameOpen(false);
    },
    onError: (err) => {
      errorToast(err instanceof Error ? err.message : 'Failed to rename session');
    },
  });

  return (
    <>
      <div className="pointer-events-none absolute top-0 right-0 left-0 z-20">
        <div className="flex items-center justify-between p-2 pb-0">
          <div className="pointer-events-auto flex items-center gap-0.5">
            {leadingAction}

            <DropdownMenu>
              <Hint
                side="bottom"
                label={tHardcodedUi.raw(
                  'componentsSessionSessionSiteHeader.line105JsxTextMoreActions',
                )}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={tHardcodedUi.raw(
                      'componentsSessionSessionSiteHeader.line105JsxTextMoreActions',
                    )}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
              </Hint>

              <DropdownMenuContent align="start" className="w-52">
                {(isProjectSession || isSimpleSession) && (
                  <>
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={() => {
                        if (isSimpleSession) {
                          setSimpleRenameValue(sessionTitle);
                          setSimpleRenameOpen(true);
                        } else {
                          setRenameOpen(true);
                        }
                      }}
                    >
                      <Pencil />
                      {tI18nHardcoded.raw(
                        'autoFeaturesSessionHeaderSessionSiteHeaderJsxTextRename41731a53',
                      )}
                    </DropdownMenuItem>
                    {isProjectSession && canShare && (
                      <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => setShareOpen(true)}
                      >
                        <Share />
                        {tI18nHardcoded.raw(
                          'autoFeaturesSessionHeaderSessionSiteHeaderJsxTextShared7d34d4f',
                        )}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      className="cursor-pointer"
                      disabled={restartMutation.isPending}
                      onClick={() => restartMutation.mutate()}
                    >
                      {restartMutation.isPending ? <Loading /> : <RotateCcw />}
                      Restart
                    </DropdownMenuItem>
                  </>
                )}

                <DropdownMenuItem className="cursor-pointer" onClick={() => setExportOpen(true)}>
                  <FileDown />
                  {tHardcodedUi.raw(
                    'componentsSessionSessionSiteHeader.line124JsxTextExportTranscript',
                  )}
                </DropdownMenuItem>

                <DropdownMenuItem className="cursor-pointer" onClick={() => setCompactOpen(true)}>
                  <Layers />
                  {tHardcodedUi.raw(
                    'componentsSessionSessionSiteHeader.line130JsxTextCompactSession',
                  )}
                </DropdownMenuItem>

                {(isProjectSession || isSimpleSession) && (
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={() => {
                      if (isSimpleSession) {
                        setSimpleDeleteOpen(true);
                      } else {
                        setDeleteOpen(true);
                      }
                    }}
                    variant="destructive"
                  >
                    <TrashSolid />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="pointer-events-auto flex items-center gap-1.5">
            <SessionChangesIndicator sessionId={sessionId} />
            <Hint
              side="bottom"
              sideOffset={4}
              delayDuration={300}
              label={
                <span className="flex items-center gap-1.5">
                  {isSidePanelOpen ? 'Close' : 'Open'} panel
                  <KbdGroup>
                    <Kbd className="font-mono">
                      {tHardcodedUi.raw('componentsSessionSessionSiteHeader.line185JsxTextI')}
                    </Kbd>
                  </KbdGroup>
                </span>
              }
            >
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleSidePanel}
                className={cn(
                  'h-8 w-8 cursor-pointer transition-colors',
                  isSidePanelOpen
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <PanelRight className="h-4 w-4" />
              </Button>
            </Hint>
          </div>
        </div>
      </div>

      <ExportTranscriptModal sessionId={sessionId} open={exportOpen} onOpenChange={setExportOpen} />
      <CompactModal sessionId={sessionId} open={compactOpen} onOpenChange={setCompactOpen} />

      {isProjectSession && (
        <>
          <ShareSessionModal
            projectId={projectId!}
            session={projectSession}
            open={shareOpen}
            onOpenChange={setShareOpen}
            onSaved={() =>
              queryClient.invalidateQueries({ queryKey: ['project-sessions', projectId] })
            }
          />
          <RenameSessionModal
            projectId={projectId!}
            sessionId={projectSessionId!}
            currentName={projectSession ? sessionDisplayLabel(projectSession) : ''}
            open={renameOpen}
            onOpenChange={setRenameOpen}
          />
          <SessionDeleteModal
            projectId={projectId!}
            sessionId={projectSessionId!}
            sessionLabel={sessionTitle}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onDeleted={() => router.push(`/projects/${projectId}`)}
          />
        </>
      )}

      {/* Simple mode: rename dialog (replaces browser prompt()) */}
      {isSimpleSession && (
        <Dialog open={simpleRenameOpen} onOpenChange={setSimpleRenameOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename session</DialogTitle>
              <DialogDescription>
                Enter a new name for this session. This will be visible in the sidebar.
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={simpleRenameValue}
              onChange={(e) => setSimpleRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && simpleRenameValue.trim()) {
                  simpleRenameMutation.mutate(simpleRenameValue.trim());
                }
              }}
              placeholder="Session name"
            />
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setSimpleRenameOpen(false)}
                disabled={simpleRenameMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => simpleRenameValue.trim() && simpleRenameMutation.mutate(simpleRenameValue.trim())}
                disabled={!simpleRenameValue.trim() || simpleRenameMutation.isPending}
              >
                {simpleRenameMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Simple mode: delete dialog (replaces browser confirm()) */}
      {isSimpleSession && (
        <AlertDialog
          open={simpleDeleteOpen}
          onOpenChange={(o) => !simpleDeleteMutation.isPending && setSimpleDeleteOpen(o)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this session?</AlertDialogTitle>
              <AlertDialogDescription>
                This will terminate the sandbox and remove all session files.
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={simpleDeleteMutation.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={simpleDeleteMutation.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  simpleDeleteMutation.mutate();
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {simpleDeleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
