'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { errorToast, successToast } from '@/components/ui/toast';
import { useAuth } from '@/features/providers/auth-provider';
import { useInstallMarketplaceItem } from '@/hooks/marketplace';
import type { MarketplaceItem } from '@/lib/marketplace-client';
import { typeMeta } from './marketplace-meta';
import { Loader2, Plug, Wrench, KeyRound } from 'lucide-react';

/**
 * InstallItemDialog — installs a marketplace item into the user's account.
 *
 * In session-only mode there is no project picker — the item is installed
 * for the authenticated user's account (resolved from the auth token).
 * The skill appears in:
 *   - All future sessions (via daemon fetchInstalledSkills at boot)
 *   - All active sessions (via live-update push)
 */
export function InstallItemDialog({
  item,
  open,
  onOpenChange,
}: {
  item: MarketplaceItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const tI18nHardcoded = useTranslations('hardcodedUi');
  const { user } = useAuth();
  const install = useInstallMarketplaceItem();

  // Resolve the accountId from the user's auth context. In session-only mode
  // the user has exactly one primary account — we read it from user_metadata.
  const accountId = (user?.app_metadata?.account_id as string) || (user?.user_metadata?.account_id as string) || '';

  const caps = item?.capabilities;
  const hasCaps = !!caps && caps.secrets.length + caps.connectors.length + caps.tools.length > 0;

  const onInstall = async () => {
    if (!item || !accountId) return;
    try {
      const res = await install.mutateAsync({ accountId, id: item.id });
      successToast(`Installed ${item.title}`, {
        description: `Added ${res.file_count} file${res.file_count === 1 ? '' : 's'}. Will appear in new sessions and active ones immediately.`,
      });
      onOpenChange(false);
    } catch (e) {
      errorToast('Install failed', { description: (e as Error).message });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-border/60 border-b px-6 pt-6 pb-4">
          <DialogTitle>Install {item?.title}</DialogTitle>
          <DialogDescription>
            This will install the {typeMeta(item?.type ?? '').label.toLowerCase()} into your account. It will be available in all your sessions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 py-5">
          {item && item.dependencies.length > 0 && (
            <p className="text-muted-foreground text-sm">
              Also installs: {item.dependencies.map((d) => d.name).join(', ')}
            </p>
          )}

          {item && (
            <p className="text-muted-foreground text-xs">
              This skill will be added to all your sessions — both new and active. No need to reinstall per session.
            </p>
          )}

          {hasCaps && (
            <div className="rounded-lg border border-border/60 p-3 space-y-2">
              <p className="text-foreground text-sm font-medium">Required capabilities</p>
              {caps!.secrets.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <KeyRound className="h-3.5 w-3.5" />
                  Needs secrets: {caps!.secrets.map((s) => s.name).join(', ')}
                </div>
              )}
              {caps!.connectors.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Plug className="h-3.5 w-3.5" />
                  Needs connectors: {caps!.connectors.map((c) => c.name).join(', ')}
                </div>
              )}
              {caps!.tools.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Wrench className="h-3.5 w-3.5" />
                  Needs tools: {caps!.tools.map((t) => t.name).join(', ')}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                After installing, the agent will prompt you to set up any missing capabilities.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="border-border/60 border-t px-6 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={install.isPending}>
            Cancel
          </Button>
          <Button onClick={onInstall} disabled={!item || !accountId || install.isPending} className="gap-2">
            {install.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {install.isPending ? 'Installing...' : 'Install'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
