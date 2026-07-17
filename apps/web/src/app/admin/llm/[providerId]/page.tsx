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
  type PlatformModel,
} from '@/lib/platform-admin-client';
import { SectionHeader, SectionContainer } from '@/app/admin/_components/section-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  Cpu,
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
  const [pendingToggles, setPendingToggles] = useState<Set<string>>(new Set());
  const [pendingDefault, setPendingDefault] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: provider, isLoading: providerLoading } = useQuery({
    queryKey: ['platform-provider', providerId],
    queryFn: () => getProvider(providerId),
    enabled: !!providerId,
  });

  const { data: models, isLoading: modelsLoading } = useQuery({
    queryKey: ['platform-models-by-provider', provider?.providerKey],
    queryFn: () => listModelsByProvider(provider!.providerKey),
    enabled: !!provider?.providerKey,
  });

  useEffect(() => {
    if (provider?.apiKeyEnc) {
      setApiKeyInput(provider.apiKeyEnc);
    }
  }, [provider]);

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

  const handleModelToggle = useCallback((modelId: string) => {
    setPendingToggles((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
    setHasChanges(true);
  }, []);

  const handleSetDefault = useCallback((modelId: string) => {
    setPendingDefault(modelId);
    setHasChanges(true);
  }, []);

  const handleSaveChanges = useCallback(async () => {
    if (!provider) return;
    try {
      for (const modelId of pendingToggles) {
        await toggleModel(modelId);
      }
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

  const isModelActive = useCallback((model: PlatformModel) => {
    if (pendingToggles.has(model.modelId)) return !model.isActive;
    return model.isActive;
  }, [pendingToggles]);

  const isModelDefault = useCallback((model: PlatformModel) => {
    if (pendingDefault) return model.modelId === pendingDefault;
    return model.isDefault;
  }, [pendingDefault]);

  if (providerLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Provider not found</p>
        <Button onClick={() => router.push('/admin/llm')} variant="outline">Back to Providers</Button>
      </div>
    );
  }

  return (
    <SectionContainer>
      <SectionHeader
        icon={Cpu}
        title={provider.displayName}
        description={provider.providerKey}
        actions={
          <Button onClick={() => router.push('/admin/llm')} variant="ghost" size="sm">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back
          </Button>
        }
      />

      {/* API Key Section */}
      <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">API Key</h2>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={showKey ? 'text' : 'password'}
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="Enter API key"
              className="pr-10"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Button onClick={handleSaveKey} disabled={savingKey || apiKeyInput === (provider.apiKeyEnc ?? '')}>
            {savingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            <span className="ml-1.5">Save Key</span>
          </Button>
        </div>
        {provider.baseUrl && (
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Base URL</label>
            <p className="mt-1 text-xs text-muted-foreground font-mono">{provider.baseUrl}</p>
          </div>
        )}
      </div>

      {/* Models Section */}
      <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Models</h2>
            {models && models.length > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {models.length}
              </span>
            )}
          </div>
          <Button onClick={handleRefresh} disabled={refreshing} variant="outline" size="sm">
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="ml-1.5">Refresh Models</span>
          </Button>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search models..."
            className="pl-9"
          />
        </div>

        {/* Models list */}
        {modelsLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredModels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <p className="text-sm text-muted-foreground">
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
                    'flex items-center gap-3 rounded-xl border p-3 transition-colors',
                    active
                      ? 'border-border/60 bg-card/50'
                      : 'border-border/40 bg-muted/20 opacity-60',
                  )}
                >
                  <div className={cn('h-2 w-2 shrink-0 rounded-full', active ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{model.displayName}</span>
                      {isDefault && (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                          <Star className="mr-1 inline h-2.5 w-2.5 fill-current" />
                          Default
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground font-mono">{model.modelKey}</p>
                  </div>

                  <Button
                    onClick={() => handleSetDefault(model.modelId)}
                    disabled={isDefault}
                    size="icon"
                    variant="ghost"
                    className={cn(
                      'h-8 w-8',
                      isDefault
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-500/10',
                    )}
                  >
                    <Star className={cn('h-4 w-4', isDefault && 'fill-current')} />
                  </Button>

                  <Button
                    onClick={() => handleModelToggle(model.modelId)}
                    size="icon"
                    variant="ghost"
                    className={cn(
                      'h-8 w-8',
                      active
                        ? 'text-emerald-600 hover:text-emerald-600 dark:text-emerald-400 dark:text-emerald-400 dark:hover:text-emerald-300 hover:bg-emerald-500/10'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted',
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
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
            <span className="text-xs text-muted-foreground">
              You have unsaved changes ({pendingToggles.size} toggle{pendingToggles.size !== 1 ? 's' : ''}
              {pendingDefault ? ', 1 default change' : ''})
            </span>
            <Button onClick={handleSaveChanges} size="sm">
              <Save className="mr-1.5 h-3.5 w-3.5" />
              Save Changes
            </Button>
          </div>
        )}
      </div>
    </SectionContainer>
  );
}
