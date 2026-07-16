'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getProviderCatalog,
  listProviders,
  createProvider,
  deleteProvider,
  toggleProvider,
  testProviderConnection,
  importModels,
  type ProviderCatalogEntry,
  type PlatformProvider,
} from '@/lib/platform-admin-client';
import { SectionHeader, SectionContainer } from '@/app/admin/_components/section-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from '@/lib/toast';
import {
  Search,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Power,
  ExternalLink,
  Zap,
  RefreshCw,
  Key,
  Eye,
  EyeOff,
  Sparkles,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

// ── Category styling ─────────────────────────────────────────────────────────

const CATEGORY_STYLES: Record<string, string> = {
  'major': 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  'fast-inference': 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  'specialized': 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  'aggregator': 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  'cloud': 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  'chinese': 'bg-red-500/10 text-red-600 dark:text-red-400',
  'other': 'bg-muted text-muted-foreground',
};

const CATEGORY_LABELS: Record<string, string> = {
  'major': 'Major',
  'fast-inference': 'Fast Inference',
  'specialized': 'Specialized',
  'aggregator': 'Aggregator',
  'cloud': 'Cloud',
  'chinese': 'Chinese',
  'other': 'Other',
};

// ── Connect Provider Modal ───────────────────────────────────────────────────

function ConnectProviderModal({
  providerKey,
  catalog,
  onClose,
  onConnected,
}: {
  providerKey: string;
  catalog: ProviderCatalogEntry;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; models?: Array<{ id: string; name: string }>; error?: string; modelsCount?: number } | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const handleTest = useCallback(async () => {
    if (!apiKey.trim()) {
      toast.error('Please enter an API key first');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testProviderConnection(providerKey, apiKey.trim());
      setTestResult(result);
      if (result.ok && result.models?.length) {
        setSelectedModel(result.models[0].id);
        toast.success(`Connected! Found ${result.modelsCount} models`);
      } else if (!result.ok) {
        toast.error(result.error || 'Connection failed');
      }
    } catch (err: any) {
      setTestResult({ ok: false, error: err.message });
      toast.error(err.message || 'Test failed');
    } finally {
      setTesting(false);
    }
  }, [apiKey, providerKey]);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) {
      toast.error('API key is required');
      return;
    }
    setSaving(true);
    try {
      const provider = await createProvider({
        providerKey,
        displayName: catalog.displayName,
        apiKeyEnc: apiKey.trim(),
        baseUrl: catalog.baseUrl,
      });

      if (testResult?.ok && testResult.models?.length) {
        await importModels(testResult.models, providerKey);
      }

      toast.success(`${catalog.displayName} connected successfully`);
      queryClient.invalidateQueries({ queryKey: ['platform-providers'] });
      queryClient.invalidateQueries({ queryKey: ['platform-models'] });
      onConnected();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save provider');
    } finally {
      setSaving(false);
    }
  }, [apiKey, providerKey, catalog, testResult, queryClient, onClose, onConnected]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            Connect {catalog.displayName}
          </DialogTitle>
          <DialogDescription>
            Enter your API key to connect this provider. The base URL is pre-configured.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* API Key Input */}
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">API Key</label>
            <div className="relative">
              <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`Enter your ${catalog.envVar || 'API key'}`}
                className="pl-9 pr-10"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <a
              href={catalog.docs}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Get API key <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {/* Base URL (read-only, pre-configured) */}
          {catalog.baseUrl && (
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Base URL (pre-configured)</label>
              <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground font-mono">
                {catalog.baseUrl}
              </div>
            </div>
          )}

          {/* Test button */}
          <Button
            onClick={handleTest}
            disabled={testing || !apiKey.trim()}
            variant="outline"
            className="w-full"
          >
            {testing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Testing connection...
              </>
            ) : (
              <>
                <Zap className="mr-2 h-4 w-4" />
                Fetch Models & Test
              </>
            )}
          </Button>

          {/* Test result */}
          {testResult && (
            <div className={cn(
              'rounded-lg border p-3 space-y-2',
              testResult.ok
                ? 'border-emerald-500/20 bg-emerald-500/5'
                : 'border-destructive/20 bg-destructive/5'
            )}>
              <div className="flex items-center gap-2">
                {testResult.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                <span className={cn('text-xs font-medium', testResult.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>
                  {testResult.ok
                    ? `Success — ${testResult.models?.length || 0} models found`
                    : `Failed — ${testResult.error || 'Unknown error'}`}
                </span>
              </div>

              {testResult.ok && testResult.models && testResult.models.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Select a model to verify:</label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full rounded-md border border-border bg-input px-3 py-2 text-xs text-foreground"
                  >
                    {testResult.models.slice(0, 100).map((m) => (
                      <option key={m.id} value={m.id}>{m.id}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !apiKey.trim()}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save & Connect'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Provider Card (Available) ────────────────────────────────────────────────

function AvailableProviderCard({
  providerKey,
  catalog,
  onConnect,
}: {
  providerKey: string;
  catalog: ProviderCatalogEntry;
  onConnect: () => void;
}) {
  return (
    <div className="group relative flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-border hover:bg-muted/30">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground">{catalog.displayName}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground font-mono">{providerKey}</p>
        </div>
        {catalog.category && (
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', CATEGORY_STYLES[catalog.category])}>
            {CATEGORY_LABELS[catalog.category]}
          </span>
        )}
      </div>

      {catalog.baseUrl ? (
        <p className="truncate text-[11px] text-muted-foreground/60 font-mono">{catalog.baseUrl}</p>
      ) : (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">Requires manual configuration</p>
      )}

      <Button onClick={onConnect} size="sm" variant="outline" disabled={!catalog.baseUrl} className="w-full">
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Connect
      </Button>
    </div>
  );
}

// ── Provider Row (Connected) ─────────────────────────────────────────────────

function ConnectedProviderRow({
  provider,
  onToggle,
  onDelete,
  onManage,
}: {
  provider: PlatformProvider;
  onToggle: () => void;
  onDelete: () => void;
  onManage: () => void;
}) {
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleToggle = useCallback(async () => {
    setToggling(true);
    try { await onToggle(); } finally { setToggling(false); }
  }, [onToggle]);

  const handleDelete = useCallback(async () => {
    if (!confirm(`Delete ${provider.displayName}? This removes all its models.`)) return;
    setDeleting(true);
    try { await onDelete(); } finally { setDeleting(false); }
  }, [provider.displayName, onDelete]);

  return (
    <div className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card/50 p-4 transition-colors hover:border-border">
      {/* Icon tile */}
      <div className="bg-primary/10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg">
        <Sparkles className="text-primary h-5 w-5" />
      </div>

      {/* Name + key */}
      <button onClick={onManage} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{provider.displayName}</span>
          {provider.isActive ? (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              Active
            </span>
          ) : (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Inactive
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground font-mono">{provider.providerKey}</p>
      </button>

      {/* API key (masked) */}
      <div className="hidden sm:block text-xs text-muted-foreground/60 font-mono">
        {provider.apiKeyEnc || '—'}
      </div>

      {/* Manage button */}
      <Button onClick={onManage} variant="ghost" size="sm" className="text-xs">
        Manage
        <ChevronRight className="ml-1 h-3 w-3" />
      </Button>

      {/* Toggle */}
      <Button
        onClick={handleToggle}
        disabled={toggling}
        size="icon"
        variant="ghost"
        className={cn(
          'h-8 w-8',
          provider.isActive
            ? 'text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 dark:hover:text-emerald-300 hover:bg-emerald-500/10'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        )}
      >
        {toggling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
      </Button>

      {/* Delete */}
      <Button
        onClick={handleDelete}
        disabled={deleting}
        size="icon"
        variant="ghost"
        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
      >
        {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </Button>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function UnifiedLLMPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'available' | 'connected'>('available');
  const [search, setSearch] = useState('');
  const [connectProvider, setConnectProvider] = useState<{ key: string; catalog: ProviderCatalogEntry } | null>(null);

  const { data: catalog, isLoading: catalogLoading } = useQuery({
    queryKey: ['provider-catalog'],
    queryFn: getProviderCatalog,
  });

  const { data: connectedProviders, isLoading: providersLoading } = useQuery({
    queryKey: ['platform-providers'],
    queryFn: listProviders,
  });

  const toggleMut = useMutation({
    mutationFn: (id: string) => toggleProvider(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-providers'] });
      toast.success('Provider toggled');
    },
    onError: (err: any) => toast.error(err.message || 'Failed to toggle'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteProvider(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-providers'] });
      queryClient.invalidateQueries({ queryKey: ['platform-models'] });
      toast.success('Provider deleted');
    },
    onError: (err: any) => toast.error(err.message || 'Failed to delete'),
  });

  const connectedKeys = useMemo(
    () => new Set((connectedProviders ?? []).map((p) => p.providerKey)),
    [connectedProviders],
  );

  const availableProviders = useMemo(() => {
    if (!catalog) return [];
    return Object.entries(catalog)
      .filter(([key]) => !connectedKeys.has(key))
      .filter(([key, val]) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return key.toLowerCase().includes(q) || val.displayName.toLowerCase().includes(q);
      })
      .sort((a, b) => a[1].displayName.localeCompare(b[1].displayName));
  }, [catalog, connectedKeys, search]);

  const filteredConnected = useMemo(() => {
    if (!connectedProviders) return [];
    if (!search.trim()) return connectedProviders;
    const q = search.toLowerCase();
    return connectedProviders.filter(
      (p) => p.providerKey.toLowerCase().includes(q) || p.displayName.toLowerCase().includes(q),
    );
  }, [connectedProviders, search]);

  return (
    <SectionContainer>
      <SectionHeader
        icon={Sparkles}
        title="LLM Providers & Models"
        description="Manage AI providers, connect API keys, and configure models for the platform."
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border/60">
        <button
          onClick={() => { setActiveTab('available'); setSearch(''); }}
          className={cn(
            'relative px-4 py-2.5 text-sm font-medium transition-colors',
            activeTab === 'available' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Available Providers
          {availableProviders.length > 0 && (
            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {availableProviders.length}
            </span>
          )}
          {activeTab === 'available' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground" />
          )}
        </button>
        <button
          onClick={() => { setActiveTab('connected'); setSearch(''); }}
          className={cn(
            'relative px-4 py-2.5 text-sm font-medium transition-colors',
            activeTab === 'connected' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Connected Providers
          {(connectedProviders?.length ?? 0) > 0 && (
            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {connectedProviders!.length}
            </span>
          )}
          {activeTab === 'connected' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground" />
          )}
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={activeTab === 'available' ? 'Search available providers...' : 'Search connected providers...'}
          className="pl-9"
        />
      </div>

      {/* Content */}
      {activeTab === 'available' ? (
        catalogLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : availableProviders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-500/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              {search ? 'No providers match your search.' : 'All providers are already connected!'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {availableProviders.map(([key, cat]) => (
              <AvailableProviderCard
                key={key}
                providerKey={key}
                catalog={cat}
                onConnect={() => setConnectProvider({ key, catalog: cat })}
              />
            ))}
          </div>
        )
      ) : (
        providersLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredConnected.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-sm text-muted-foreground">
              {search ? 'No providers match your search.' : 'No providers connected yet. Go to the Available tab to connect one.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredConnected.map((provider) => (
              <ConnectedProviderRow
                key={provider.providerId}
                provider={provider}
                onToggle={() => toggleMut.mutate(provider.providerId)}
                onDelete={() => deleteMut.mutate(provider.providerId)}
                onManage={() => router.push(`/admin/llm/${provider.providerId}`)}
              />
            ))}
          </div>
        )
      )}

      {/* Connect Modal */}
      {connectProvider && (
        <ConnectProviderModal
          providerKey={connectProvider.key}
          catalog={connectProvider.catalog}
          onClose={() => setConnectProvider(null)}
          onConnected={() => {
            queryClient.invalidateQueries({ queryKey: ['platform-providers'] });
            queryClient.invalidateQueries({ queryKey: ['platform-models'] });
          }}
        />
      )}
    </SectionContainer>
  );
}
