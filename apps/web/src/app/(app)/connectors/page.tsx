'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  listUserConnectors, createUserConnector, updateUserConnector, deleteUserConnector,
  type UserConnector,
} from '@/lib/connectors-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plug, Plus, Trash2, Loader2, CheckCircle2, AlertCircle, Power } from 'lucide-react';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

export default function ConnectorsPage() {
  return (
    <Suspense fallback={null}>
      <ConnectorsContent />
    </Suspense>
  );
}

function ConnectorsContent() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  // Check for OAuth callback params
  const oauthConnected = params.get('connected') === 'true';
  const oauthError = params.get('error') === 'true';

  const { data: connectors, isLoading } = useQuery({
    queryKey: ['user-connectors'],
    queryFn: listUserConnectors,
  });

  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: (data: { slug: string; name: string; providerType: string; config?: Record<string, unknown> }) =>
      createUserConnector(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-connectors'] });
      toast.success('Connector added');
      setCreating(false);
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to create connector'),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateUserConnector(id, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-connectors'] });
    },
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteUserConnector(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-connectors'] });
      toast.success('Connector removed');
      setDeleteId(null);
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to delete'),
  });

  // If this is an OAuth callback, show the result screen
  if (oauthConnected || oauthError) {
    return (
      <div className="bg-background fixed inset-0 flex items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-5 text-center">
          <div className="border-border bg-muted/40 mx-auto flex h-14 w-14 items-center justify-center rounded-full border">
            {oauthConnected ? (
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            ) : (
              <AlertCircle className="text-destructive h-6 w-6" />
            )}
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight">
              {oauthConnected ? 'Connector connected' : 'Connection failed'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {oauthConnected
                ? 'Authorized. You can close this tab and return to your session.'
                : 'The authorization did not complete. Please try again.'}
            </p>
          </div>
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" onClick={() => window.close()}>Close</Button>
            <Button variant="ghost" onClick={() => router.replace('/sessions')}>Go to Sessions</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Plug className="h-6 w-6" /> Connectors
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage your integrations. Connectors let your agent interact with external services.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Add Connector
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !connectors || connectors.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          No connectors yet. Click "Add Connector" to connect an external service.
        </div>
      ) : (
        <div className="space-y-3">
          {connectors.map((conn) => (
            <div
              key={conn.connectorId}
              className="border-border/60 bg-card/50 flex items-start gap-4 rounded-xl border p-4"
            >
              <div className="bg-primary/10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg">
                <Plug className="text-primary h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{conn.name}</h3>
                  <span className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    conn.enabled
                      ? 'bg-emerald-500/15 text-emerald-500'
                      : 'bg-muted text-muted-foreground',
                  )}>
                    {conn.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <span className="rounded-full bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {conn.providerType}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  Slug: <code className="bg-muted px-1 rounded">{conn.slug}</code>
                  {conn.lastError && (
                    <span className="text-red-500"> · Error: {conn.lastError}</span>
                  )}
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleMut.mutate({ id: conn.connectorId, enabled: !conn.enabled })}
                  className="text-xs"
                >
                  <Power className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteId(conn.connectorId)}
                  className="text-muted-foreground hover:text-destructive text-xs"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <ConnectorEditor
          onSave={(data) => createMut.mutate(data)}
          onClose={() => setCreating(false)}
          isPending={createMut.isPending}
        />
      )}

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this connector?</AlertDialogTitle>
            <AlertDialogDescription>
              Your agent will no longer be able to use this integration.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => deleteId && delMut.mutate(deleteId)}
              disabled={delMut.isPending}
            >
              {delMut.isPending ? 'Removing...' : 'Remove'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ConnectorEditor({ onSave, onClose, isPending }: {
  onSave: (data: { slug: string; name: string; providerType: string; config?: Record<string, unknown> }) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [providerType, setProviderType] = useState('http');
  const [configJson, setConfigJson] = useState('{}');

  const providerTypes = [
    { value: 'http', label: 'HTTP API' },
    { value: 'mcp', label: 'MCP Server' },
    { value: 'openapi', label: 'OpenAPI Spec' },
    { value: 'pipedream', label: 'Pipedream App' },
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Connector</DialogTitle>
          <DialogDescription>
            Connect an external service for your agent to use.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My Slack Workspace"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Slug</label>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              placeholder="e.g. my-slack"
              className="mt-1"
            />
            <p className="text-muted-foreground mt-1 text-xs">Lowercase letters, numbers, and hyphens only.</p>
          </div>
          <div>
            <label className="text-sm font-medium">Type</label>
            <select
              value={providerType}
              onChange={(e) => setProviderType(e.target.value)}
              className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
            >
              {providerTypes.map(pt => (
                <option key={pt.value} value={pt.value}>{pt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Configuration (JSON)</label>
            <textarea
              value={configJson}
              onChange={(e) => setConfigJson(e.target.value)}
              className="border-input bg-background mt-1 min-h-[100px] w-full rounded-md border px-3 py-2 font-mono text-xs"
              placeholder='{"url": "https://api.example.com", "headers": {}}'
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              try {
                const config = JSON.parse(configJson);
                onSave({ slug, name, providerType, config });
              } catch {
                toast.error('Invalid JSON in configuration');
              }
            }}
            disabled={!slug.trim() || !name.trim() || isPending}
          >
            {isPending ? 'Adding...' : 'Add Connector'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
