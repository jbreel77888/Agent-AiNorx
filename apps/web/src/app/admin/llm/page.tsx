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
import { SectionHeader } from '@/app/admin/_components/section-header';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

// ── Category colors ──────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  'major': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'fast-inference': 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  'specialized': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  'aggregator': 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  'cloud': 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  'chinese': 'bg-red-500/10 text-red-400 border-red-500/20',
  'other': 'bg-gray-500/10 text-gray-400 border-gray-500/20',
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
  const [testResult, setTestResult] = useState<{ ok: boolean; models?: Array<{ id: string; name: string }>; error?: string } | null>(null);
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
      // 1. Create the provider
      const provider = await createProvider({
        providerKey,
        displayName: catalog.displayName,
        apiKeyEnc: apiKey.trim(),
        baseUrl: catalog.baseUrl,
      });

      // 2. Import models if test was successful
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
      <DialogContent className="max-w-lg bg-zinc-950 border-zinc-800">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-zinc-100">
            <Zap className="h-4 w-4 text-indigo-400" />
            Connect {catalog.displayName}
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Enter your API key to connect this provider. The base URL is pre-configured.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* API Key Input */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-400">API Key</label>
            <div className="relative">
              <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`Enter your ${catalog.envVar || 'API key'}`}
                className="pl-9 pr-10 bg-zinc-900 border-zinc-800 text-zinc-100 placeholder:text-zinc-600"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <a
              href={catalog.docs}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300"
            >
              Get API key <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {/* Base URL (read-only, pre-configured) */}
          {catalog.baseUrl && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-400">Base URL (pre-configured)</label>
              <div className="rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-xs text-zinc-500 font-mono">
                {catalog.baseUrl}
              </div>
            </div>
          )}

          {/* Test button */}
          <Button
            onClick={handleTest}
            disabled={testing || !apiKey.trim()}
            variant="outline"
            className="w-full bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800"
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
                ? 'bg-emerald-500/5 border-emerald-500/20'
                : 'bg-red-500/5 border-red-500/20'
            )}>
              <div className="flex items-center gap-2">
                {testResult.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400" />
                )}
                <span className={cn('text-xs font-medium', testResult.ok ? 'text-emerald-400' : 'text-red-400')}>
                  {testResult.ok
                    ? `Success — ${testResult.models?.length || 0} models found`
                    : `Failed — ${testResult.error || 'Unknown error'}`}
                </span>
              </div>

              {/* Model dropdown for testing */}
              {testResult.ok && testResult.models && testResult.models.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-400">Select a model to verify:</label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-xs text-zinc-200"
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
          <Button variant="ghost" onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !apiKey.trim()}
            className="bg-indigo-600 hover:bg-indigo-500 text-white"
          >
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
    <div className="group relative flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 transition-all hover:border-zinc-700 hover:bg-zinc-900/50">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-zinc-100">{catalog.displayName}</h3>
          <p className="mt-0.5 truncate text-xs text-zinc-500 font-mono">{providerKey}</p>
        </div>
        {catalog.category && (
          <Badge variant="outline" className={cn('shrink-0 border text-[10px]', CATEGORY_COLORS[catalog.category])}>
            {CATEGORY_LABELS[catalog.category]}
          </Badge>
        )}
      </div>

      {/* Base URL */}
      {catalog.baseUrl ? (
        <p className="truncate text-[11px] text-zinc-600 font-mono">{catalog.baseUrl}</p>
      ) : (
        <p className="text-[11px] text-amber-500/70">Requires manual configuration</p>
      )}

      {/* Connect button */}
      <Button
        onClick={onConnect}
        size="sm"
        className="w-full bg-zinc-800 text-zinc-200 hover:bg-zinc-700 border border-zinc-700"
        disabled={!catalog.baseUrl}
      >
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
    try {
      await onToggle();
    } finally {
      setToggling(false);
    }
  }, [onToggle]);

  const handleDelete = useCallback(async () => {
    if (!confirm(`Delete ${provider.displayName}? This removes all its models.`)) return;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  }, [provider.displayName, onDelete]);

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 transition-all hover:border-zinc-700">
      {/* Status dot */}
      <div className={cn(
        'h-2 w-2 shrink-0 rounded-full',
        provider.isActive ? 'bg-emerald-500' : 'bg-zinc-600'
      )} />

      {/* Name + key */}
      <button onClick={onManage} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-zinc-100">{provider.displayName}</span>
          {provider.isActive && (
            <Badge variant="outline" className="border-emerald-500/20 bg-emerald-500/5 text-emerald-400 text-[10px]">
              Active
            </Badge>
          )}
        </div>
        <p className="truncate text-xs text-zinc-500 font-mono">{provider.providerKey}</p>
      </button>

      {/* API key (masked) */}
      <div className="hidden sm:block text-xs text-zinc-600 font-mono">
        {provider.apiKeyEnc || '—'}
      </div>

      {/* Toggle */}
      <Button
        onClick={handleToggle}
        disabled={toggling}
        size="icon"
        variant="ghost"
        className={cn(
          'h-8 w-8',
          provider.isActive
            ? 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10'
            : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
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
        className="h-8 w-8 text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
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

  // Fetch catalog
  const { data: catalog, isLoading: catalogLoading } = useQuery({
    queryKey: ['provider-catalog'],
    queryFn: getProviderCatalog,
  });

  // Fetch connected providers
  const { data: connectedProviders, isLoading: providersLoading } = useQuery({
    queryKey: ['platform-providers'],
    queryFn: listProviders,
  });

  // Toggle mutation
  const toggleMut = useMutation({
    mutationFn: (id: string) => toggleProvider(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-providers'] });
      toast.success('Provider toggled');
    },
    onError: (err: any) => toast.error(err.message || 'Failed to toggle'),
  });

  // Delete mutation
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteProvider(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-providers'] });
      queryClient.invalidateQueries({ queryKey: ['platform-models'] });
      toast.success('Provider deleted');
    },
    onError: (err: any) => toast.error(err.message || 'Failed to delete'),
  });

  // Filter available providers (not connected)
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
    <div className="min-h-screen bg-zinc-950">
      <SectionHeader icon={Sparkles}
        title="LLM Providers & Models"
        description="Manage AI providers, connect API keys, and configure models for the platform."
      />

      <div className="mx-auto max-w-7xl px-6 py-6">
        {/* Tabs */}
        <div className="mb-6 flex items-center gap-1 border-b border-zinc-800">
          <button
            onClick={() => { setActiveTab('available'); setSearch(''); }}
            className={cn(
              'relative px-4 py-2.5 text-sm font-medium transition-colors',
              activeTab === 'available'
                ? 'text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            )}
          >
            Available Providers
            {availableProviders.length > 0 && (
              <span className="ml-2 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                {availableProviders.length}
              </span>
            )}
            {activeTab === 'available' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500" />
            )}
          </button>
          <button
            onClick={() => { setActiveTab('connected'); setSearch(''); }}
            className={cn(
              'relative px-4 py-2.5 text-sm font-medium transition-colors',
              activeTab === 'connected'
                ? 'text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            )}
          >
            Connected Providers
            {(connectedProviders?.length ?? 0) > 0 && (
              <span className="ml-2 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                {connectedProviders!.length}
              </span>
            )}
            {activeTab === 'connected' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500" />
            )}
          </button>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={activeTab === 'available' ? 'Search available providers...' : 'Search connected providers...'}
              className="pl-9 bg-zinc-900 border-zinc-800 text-zinc-100 placeholder:text-zinc-600"
            />
          </div>
        </div>

        {/* Content */}
        {activeTab === 'available' ? (
          // ── Available Providers Tab ──
          catalogLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-600" />
            </div>
          ) : availableProviders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-500/50 mb-3" />
              <p className="text-sm text-zinc-400">
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
          // ── Connected Providers Tab ──
          providersLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-600" />
            </div>
          ) : filteredConnected.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <p className="text-sm text-zinc-400">
                {search ? 'No providers match your search.' : 'No providers connected yet. Go to the Available tab to connect one.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
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
      </div>

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
    </div>
  );
}
