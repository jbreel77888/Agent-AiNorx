'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useParams } from 'next/navigation';
import {
  getProvider,
  updateProvider,
  toggleModel,
  setDefaultModel,
  refreshProviderModels,
  listModelsByProvider,
  type PlatformProvider,
  type PlatformModel,
} from '@/lib/platform-admin-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/lib/toast';
import {
  ArrowLeft,
  Search,
  RefreshCw,
  Star,
  Power,
  Save,
  Loader2,
  Key,
  Eye,
  EyeOff,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ProviderDetailPage() {
  const params = useParams<{ providerId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const providerId = params.providerId;

  const [search, setSearch] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Track pending model changes (toggles + default) before saving
  const [pendingToggles, setPendingToggles] = useState<Set<string>>(new Set());
  const [pendingDefault, setPendingDefault] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch provider (with full API key)
  const { data: provider, isLoading: providerLoading } = useQuery({
    queryKey: ['platform-provider', providerId],
    queryFn: () => getProvider(providerId),
    enabled: !!providerId,
  });

  // Fetch models for this provider
  const { data: models, isLoading: modelsLoading } = useQuery({
    queryKey: ['platform-models-by-provider', provider?.providerKey],
    queryFn: () => listModelsByProvider(provider!.providerKey),
    enabled: !!provider?.providerKey,
  });

  // Initialize API key input when provider loads
  useEffect(() => {
    if (provider?.apiKeyEnc) {
      setApiKeyInput(provider.apiKeyEnc);
    }
  }, [provider]);

  // Filtered models
  const filteredModels = useMemo(() => {
    if (!models) return [];
    if (!search.trim()) return models;
    const q = search.toLowerCase();
    return models.filter(
      (m) =>
        m.modelKey.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q) ||
        (m.upstreamModelId ?? '').toLowerCase().includes(q),
    );
  }, [models, search]);

  // Save API key
  const handleSaveKey = useCallback(async () => {
    if (!provider) return;
    setSavingKey(true);
    try {
      await updateProvider(provider.providerId, { apiKeyEnc: apiKeyInput.trim() });
      toast.success('API key updated');
      queryClient.invalidateQueries({ queryKey: ['platform-provider', providerId] });
      queryClient.invalidateQueries({ queryKey: ['platform-providers'] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to save API key');
    } finally {
      setSavingKey(false);
    }
  }, [provider, apiKeyInput, providerId, queryClient]);

  // Refresh models from provider
  const handleRefresh = useCallback(async () => {
    if (!provider) return;
    setRefreshing(true);
    try {
      const result = await refreshProviderModels(provider.providerId);
      toast.success(`Refreshed: ${result.imported} new, ${result.updated} updated, ${result.total} total`);
      queryClient.invalidateQueries({ queryKey: ['platform-models-by-provider', provider.providerKey] });
      queryClient.invalidateQueries({ queryKey: ['platform-models'] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to refresh models');
    } finally {
      setRefreshing(false);
    }
  }, [provider, queryClient]);

  // Toggle a model locally (pending save)
  const handleModelToggle = useCallback((modelId: string) => {
    setPendingToggles((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
    setHasChanges(true);
  }, []);

  // Set default model locally (pending save)
  const handleSetDefault = useCallback((modelId: string) => {
    setPendingDefault(modelId);
    setHasChanges(true);
  }, []);

  // Save all pending changes
  const handleSaveChanges = useCallback(async () => {
    if (!provider) return;
    try {
      // Apply pending toggles
      for (const modelId of pendingToggles) {
        await toggleModel(modelId);
      }
      // Apply pending default
      if (pendingDefault) {
        await setDefaultModel(pendingDefault);
      }
      toast.success('Changes saved');
      setPendingToggles(new Set());
      setPendingDefault(null);
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: ['platform-models-by-provider', provider.providerKey] });
      queryClient.invalidateQueries({ queryKey: ['platform-models'] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to save changes');
    }
  }, [provider, pendingToggles, pendingDefault, queryClient]);

  // Helper to check if a model is active (considering pending toggles)
  const isModelActive = useCallback((model: PlatformModel) => {
    if (pendingToggles.has(model.modelId)) return !model.isActive;
    return model.isActive;
  }, [pendingToggles]);

  // Helper to check if a model is default (considering pending default)
  const isModelDefault = useCallback((model: PlatformModel) => {
    if (pendingDefault) return model.modelId === pendingDefault;
    return model.isDefault;
  }, [pendingDefault]);

  if (providerLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-600" />
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-zinc-400">Provider not found</p>
        <Button onClick={() => router.push('/admin/llm')} variant="outline">
          Back to Providers
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <div className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-6 py-4">
          <div className="flex items-center gap-3">
            <Button
              onClick={() => router.push('/admin/llm')}
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-zinc-400 hover:text-zinc-200"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1">
              <h1 className="text-lg font-semibold text-zinc-100">{provider.displayName}</h1>
              <p className="text-xs text-zinc-500 font-mono">{provider.providerKey}</p>
            </div>
            {provider.isActive ? (
              <Badge variant="outline" className="border-emerald-500/20 bg-emerald-500/5 text-emerald-400">
                Active
              </Badge>
            ) : (
              <Badge variant="outline" className="border-zinc-700 bg-zinc-800 text-zinc-400">
                Inactive
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-8 px-6 py-6">
        {/* API Key Section */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Key className="h-4 w-4 text-indigo-400" />
            API Key
          </h2>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="Enter API key"
                className="bg-zinc-900 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 pr-10"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button
              onClick={handleSaveKey}
              disabled={savingKey || apiKeyInput === (provider.apiKeyEnc ?? '')}
              className="bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              {savingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              <span className="ml-1.5">Save Key</span>
            </Button>
          </div>
          {provider.baseUrl && (
            <div className="mt-3">
              <label className="text-xs font-medium text-zinc-500">Base URL</label>
              <p className="mt-1 text-xs text-zinc-400 font-mono">{provider.baseUrl}</p>
            </div>
          )}
        </div>

        {/* Models Section */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <span>Models</span>
              {models && models.length > 0 && (
                <Badge variant="outline" className="border-zinc-700 bg-zinc-800 text-zinc-400 text-[10px]">
                  {models.length}
                </Badge>
              )}
            </h2>
            <Button
              onClick={handleRefresh}
              disabled={refreshing}
              variant="outline"
              size="sm"
              className="bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800"
            >
              {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <span className="ml-1.5">Refresh Models</span>
            </Button>
          </div>

          {/* Search + Test dropdown */}
          <div className="mb-4 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                className="pl-9 bg-zinc-900 border-zinc-800 text-zinc-100 placeholder:text-zinc-600"
              />
            </div>
          </div>

          {/* Models list */}
          {modelsLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <p className="text-sm text-zinc-400">
                {search ? 'No models match your search.' : 'No models yet. Click "Refresh Models" to fetch them from the provider.'}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-1">
              {filteredModels.map((model) => {
                const active = isModelActive(model);
                const isDefault = isModelDefault(model);
                return (
                  <div
                    key={model.modelId}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border p-3 transition-colors',
                      active
                        ? 'border-zinc-800 bg-zinc-900/50'
                        : 'border-zinc-800/50 bg-zinc-950/30 opacity-60',
                    )}
                  >
                    {/* Status dot */}
                    <div className={cn('h-2 w-2 shrink-0 rounded-full', active ? 'bg-emerald-500' : 'bg-zinc-600')} />

                    {/* Model info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-zinc-100">{model.displayName}</span>
                        {isDefault && (
                          <Badge variant="outline" className="border-amber-500/20 bg-amber-500/5 text-amber-400 text-[10px]">
                            <Star className="mr-1 h-2.5 w-2.5 fill-current" />
                            Default
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-xs text-zinc-500 font-mono">{model.modelKey}</p>
                    </div>

                    {/* Set default button */}
                    <Button
                      onClick={() => handleSetDefault(model.modelId)}
                      disabled={isDefault}
                      size="icon"
                      variant="ghost"
                      className={cn(
                        'h-8 w-8',
                        isDefault
                          ? 'text-amber-400'
                          : 'text-zinc-500 hover:text-amber-400 hover:bg-amber-500/10',
                      )}
                    >
                      <Star className={cn('h-4 w-4', isDefault && 'fill-current')} />
                    </Button>

                    {/* Toggle button */}
                    <Button
                      onClick={() => handleModelToggle(model.modelId)}
                      size="icon"
                      variant="ghost"
                      className={cn(
                        'h-8 w-8',
                        active
                          ? 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10'
                          : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800',
                      )}
                    >
                      <Power className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Save changes bar */}
          {hasChanges && (
            <div className="mt-4 flex items-center justify-between rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3">
              <span className="text-xs text-indigo-300">
                You have unsaved changes ({pendingToggles.size} toggle{pendingToggles.size !== 1 ? 's' : ''}
                {pendingDefault ? ', 1 default change' : ''})
              </span>
              <Button
                onClick={handleSaveChanges}
                size="sm"
                className="bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                <Save className="mr-1.5 h-3.5 w-3.5" />
                Save Changes
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
