'use client';

import React, { useState } from 'react';
import { Plus, Monitor, Trash2, Search, X, Copy, Check, Cable } from 'lucide-react';
import { getEnv } from '@/lib/env-config';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { useTunnelConnections, useDeleteTunnelConnection, type TunnelConnection } from '@/hooks/tunnel/use-tunnel';
import { toast } from '@/lib/toast';

/**
 * Simplified TunnelOverview — no next-intl translation dependencies.
 *
 * The original TunnelOverview used tHardcodedUi.raw('componentsTunnelTunnelOverview.*')
 * for every string, but those keys don't exist in translations/en.json →
 * React error #130 (Element type is invalid: got undefined).
 *
 * This version uses hardcoded English strings and inline management
 * (no TunnelSettingsDialog — that also has missing translation keys).
 */
export function TunnelOverview() {
  const { data: connections, isLoading } = useTunnelConnections();
  const deleteMutation = useDeleteTunnelConnection();
  const [search, setSearch] = useState('');
  const [showConnect, setShowConnect] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TunnelConnection | null>(null);

  const filtered = (connections ?? []).filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Monitor className="text-muted-foreground size-5" />
          <h2 className="text-lg font-semibold">Connected Machines</h2>
          {connections && connections.length > 0 && (
            <Badge variant="secondary">{connections.length}</Badge>
          )}
        </div>
        <Button onClick={() => setShowConnect(true)} size="sm">
          <Plus className="size-4" />
          <span className="hidden xs:inline">Connect a machine</span>
          <span className="xs:hidden">Connect</span>
        </Button>
      </div>

      {/* Search */}
      {connections && connections.length > 0 && (
        <div className="relative">
          <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search connections..."
            className="bg-background border-border focus:border-primary w-full rounded-md border py-2 pl-9 pr-3 text-sm outline-none transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-muted-foreground hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2 rounded p-1"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && (!connections || connections.length === 0) && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <Cable className="text-muted-foreground mb-3 size-10" />
          <h3 className="text-base font-medium">No machines connected</h3>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">
            Connect your laptop or desktop so the agent can securely reach your files, shell, and desktop.
          </p>
          <Button onClick={() => setShowConnect(true)} className="mt-4" size="sm">
            <Plus className="size-4" />
            Connect your first machine
          </Button>
        </div>
      )}

      {/* Connections list */}
      {!isLoading && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((conn) => (
            <ConnectionRow
              key={conn.tunnelId}
              conn={conn}
              onDelete={() => setDeleteTarget(conn)}
            />
          ))}
          {filtered.length === 0 && search && (
            <div className="text-muted-foreground py-8 text-center text-sm">
              No connections matching &ldquo;{search}&rdquo;
            </div>
          )}
        </div>
      )}

      {/* Connect dialog */}
      <ConnectDialog open={showConnect} onOpenChange={setShowConnect} />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete connection</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <span className="text-foreground font-medium">{deleteTarget?.name}</span> and remove all its permissions and audit logs. The agent will no longer be able to reach this machine.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!deleteTarget) return;
                try {
                  await deleteMutation.mutateAsync(deleteTarget.tunnelId);
                  toast.success('Connection deleted');
                  setDeleteTarget(null);
                } catch (err) {
                  toast.error('Failed to delete connection');
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Connection Row ───────────────────────────────────────────────────────

function ConnectionRow({
  conn,
  onDelete,
}: {
  conn: TunnelConnection;
  onDelete: () => void;
}) {
  const isOnline = conn.status === 'online';
  const lastSeen = conn.lastHeartbeatAt
    ? new Date(conn.lastHeartbeatAt).toLocaleString()
    : 'never';

  return (
    <div className="hover:bg-accent/50 group flex items-center gap-3 rounded-lg border p-3 transition-colors">
      {/* Status dot */}
      <div className="relative flex-shrink-0">
        <Monitor className="text-muted-foreground size-5" />
        <span
          className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-background ${
            isOnline ? 'bg-emerald-500' : 'bg-muted-foreground/40'
          }`}
        />
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col items-start text-left">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{conn.name}</span>
          {isOnline ? (
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 gap-1 text-[10px]">
              <span className="bg-emerald-500 size-1.5 rounded-full" />
              Online
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground text-[10px]">
              Offline
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
          {conn.machineInfo?.platform && <span>{conn.machineInfo.platform}</span>}
          {conn.machineInfo?.hostname && <span>· {conn.machineInfo.hostname}</span>}
          <span>· Last seen: {lastSeen}</span>
        </div>
        {conn.capabilities && conn.capabilities.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {conn.capabilities.map((cap) => (
              <span
                key={cap}
                className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-medium"
              >
                {cap}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          onClick={onDelete}
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive size-8"
          title="Delete connection"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Connect Dialog ───────────────────────────────────────────────────────

function ConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [copied, setCopied] = useState(false);

  // Build the connect command using the runtime BACKEND_URL
  const backend = (getEnv().BACKEND_URL || '').replace(/\/+$/, '');
  // For the CLI we want the absolute API origin (not the root-relative proxy
  // path used in-sandbox). BACKEND_URL may be root-relative in the sandbox
  // preview — resolve against the current origin.
  const absolute =
    backend.startsWith('http') || backend.startsWith('https')
      ? backend
      : `${typeof window !== 'undefined' ? window.location.origin : ''}${backend}`;
  const command = `npx @vaelonx/agent-tunnel connect --api-url ${absolute}/tunnel`;

  const copy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect a machine</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Run this command on the machine you want to connect (your laptop, desktop, or any computer with Node.js installed):
          </p>

          <div className="bg-muted relative rounded-md p-3 pr-10">
            <pre className="overflow-x-auto text-xs">
              <code>{command}</code>
            </pre>
            <button
              onClick={copy}
              className="text-muted-foreground hover:text-foreground absolute right-2 top-2 rounded p-1"
              title="Copy"
            >
              {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
            </button>
          </div>

          <div className="bg-muted/50 rounded-md p-3 text-sm">
            <p className="mb-1 font-medium">What happens next:</p>
            <ol className="text-muted-foreground list-decimal space-y-1 pl-4 text-xs">
              <li>The CLI opens your browser to an approval page</li>
              <li>You pick which capabilities to grant (files, shell, desktop)</li>
              <li>The machine appears here as &ldquo;Online&rdquo;</li>
              <li>The agent can then reach it from any session</li>
            </ol>
          </div>

          <p className="text-muted-foreground text-xs">
            Requires Node.js 18+. The CLI installs <code className="bg-muted rounded px-1">@vaelonx/agent-tunnel</code> via npx (no global install needed).
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
