'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  listUserConnectors, createUserConnector, updateUserConnector, deleteUserConnector,
  listCatalogApps, startPipedreamConnect, getPipedreamStatus,
  type UserConnector, type CatalogApp,
} from '@/lib/connectors-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Plug, Plus, Trash2, Loader2, CheckCircle2, AlertCircle, Power,
  Search, Boxes, ExternalLink,
} from 'lucide-react';
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

  const { data: pipedreamStatus } = useQuery({
    queryKey: ['pipedream-status'],
    queryFn: getPipedreamStatus,
  });

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: (data: { slug: string; name: string; providerType: string; config?: Record<string, unknown> }) =>
      createUserConnector(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-connectors'] });
      toast.success('Connector added');
      setShowAddDialog(false);
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
            <Button variant="ghost" onClick={() => router.replace('/connectors')}>Back to Connectors</Button>
          </div>
        </div>
      </div>
    );
  }

  const pipedreamConfigured = pipedreamStatus?.configured ?? false;

  return (
    <div className="flex h-full flex-col p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Plug className="h-6 w-6" /> Connectors
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage your integrations. Connectors let your agent interact with external services.
          </p>
        </div>
        <Button onClick={() => setShowAddDialog(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Add Connector
        </Button>
      </div>

      {/* Connected connectors list */}
      <div className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Boxes className="h-4 w-4" />
          Connected ({connectors?.length ?? 0})
        </h2>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !connectors || connectors.length === 0 ? (
          <div className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
            No connectors yet. Browse the catalog below to connect an external service.
          </div>
        ) : (
          <div className="space-y-2">
            {connectors.map((conn) => (
              <div
                key={conn.connectorId}
                className="border-border/60 bg-card/50 flex items-start gap-4 rounded-xl border p-4"
              >
                <div className="bg-primary/10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg">
                  <Plug className="text-primary h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{conn.name}</h3>
                    <Badge variant={conn.enabled ? 'success' : 'outline'} size="sm">
                      {conn.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                    <Badge variant="outline" size="sm">{conn.providerType}</Badge>
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
                    size="icon"
                    onClick={() => toggleMut.mutate({ id: conn.connectorId, enabled: !conn.enabled })}
                  >
                    <Power className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteId(conn.connectorId)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Catalog browser */}
      <AppCatalog pipedreamConfigured={pipedreamConfigured} />

      {/* Add Connector dialog */}
      {showAddDialog && (
        <ConnectorEditor
          onSave={(data) => createMut.mutate(data)}
          onClose={() => setShowAddDialog(false)}
          isPending={createMut.isPending}
        />
      )}

      {/* Delete confirmation */}
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

// ─── App Catalog Browser (Pipedream-powered) ──────────────────────────────

function AppCatalog({ pipedreamConfigured }: { pipedreamConfigured: boolean }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [apps, setApps] = useState<CatalogApp[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch apps
  const fetchApps = useCallback(async (query: string, resetCursor?: boolean) => {
    setLoading(true);
    try {
      const result = await listCatalogApps(query || undefined, resetCursor ? undefined : cursor);
      if (resetCursor) {
        setApps(result.apps);
      } else {
        setApps(prev => [...prev, ...result.apps]);
      }
      setCursor(result.nextCursor);
      setHasMore(result.hasMore);
      setTotalCount(result.totalCount);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load catalog');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [cursor]);

  // Initial load + search changes
  useEffect(() => {
    if (!pipedreamConfigured) return;
    setApps([]);
    setCursor(undefined);
    fetchApps(debouncedSearch, true);
  }, [debouncedSearch, pipedreamConfigured]);

  // Infinite scroll with IntersectionObserver
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || loading || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
          setLoadingMore(true);
          fetchApps(debouncedSearch, false);
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, debouncedSearch]);

  if (!pipedreamConfigured) {
    return (
      <div>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Search className="h-4 w-4" />
          Browse Catalog
        </h2>
        <div className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
          Catalog browsing is not available. Pipedream is not configured.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        <Search className="h-4 w-4" />
        Browse Catalog
        {totalCount > 0 && (
          <span className="text-xs font-normal">({totalCount.toLocaleString()} apps available)</span>
        )}
      </h2>

      {/* Search bar */}
      <div className="relative mb-4">
        <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search 3,000+ apps — Slack, GitHub, Notion, Gmail..."
          className="pl-9"
        />
      </div>

      {/* App grid */}
      {loading && apps.length === 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-2xl" />
          ))}
        </div>
      ) : apps.length === 0 ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
          {debouncedSearch ? `No apps found for "${debouncedSearch}"` : 'No apps available'}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {apps.map((app) => (
              <AppCard key={app.slug} app={app} />
            ))}
            {loadingMore && Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={`loading-${i}`} className="h-[104px] rounded-2xl" />
            ))}
          </div>
          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-4" />
          {hasMore && !loadingMore && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setLoadingMore(true);
                  fetchApps(debouncedSearch, false);
                }}
              >
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── App Card (single service in the grid) ────────────────────────────────

function AppCard({ app }: { app: CatalogApp }) {
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const result = await startPipedreamConnect(app.slug);
      if (result.connectUrl) {
        window.open(result.connectUrl, '_blank', 'width=600,height=700');
      } else {
        toast.info('Opening Pipedream connect flow...');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to start connection');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <button
      onClick={handleConnect}
      disabled={connecting}
      className={cn(
        'group relative flex flex-col gap-2 rounded-2xl border border-border/60 p-4 text-left',
        'hover:border-primary/40 hover:bg-primary/[0.03] transition-all',
        connecting && 'opacity-60',
      )}
    >
      {/* Connect icon (top-right) */}
      <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100">
        {connecting ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <Plus className="h-4 w-4 text-primary" />
        )}
      </div>

      {/* App icon */}
      <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-muted/40">
        {app.imgSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={app.imgSrc}
            alt={app.name}
            className="h-7 w-7 object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <Plug className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      {/* App name + category */}
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold">{app.name}</h3>
        <p className="text-muted-foreground truncate text-xs">
          {app.categories?.[0] || app.authType || 'Service'}
        </p>
      </div>

      {/* Description (2 lines) */}
      {app.description && (
        <p className="text-muted-foreground line-clamp-2 text-xs">
          {app.description}
        </p>
      )}

      {/* Auth type badge */}
      {app.authType && app.authType !== 'none' && (
        <Badge variant="outline" size="sm" className="mt-auto w-fit">
          {app.authType === 'oauth' ? 'OAuth' : app.authType === 'keys' ? 'API Key' : app.authType}
        </Badge>
      )}
    </button>
  );
}

// ─── Custom Connector Editor (manual JSON config) ─────────────────────────

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
