'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  getProviderCatalog, testProviderConnection, importModels,
  listProviders, createProvider, updateProvider, deleteProvider,
  type ProviderCatalogEntry,
} from '@/lib/platform-admin-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Sparkles, Key, CheckCircle2, XCircle, Loader2, Trash2, ExternalLink, Download } from 'lucide-react';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

interface FetchedModel { id: string; name: string }

export default function AdminLLMProvidersPage() {
  const queryClient = useQueryClient();

  const { data: catalog } = useQuery({
    queryKey: ['provider-catalog'],
    queryFn: getProviderCatalog,
  });
  const { data: savedProviders } = useQuery({
    queryKey: ['admin-providers'],
    queryFn: listProviders,
  });

  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; models?: FetchedModel[]; error?: string }>>({});
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});

  const testMut = useMutation({
    mutationFn: ({ providerKey, apiKey }: { providerKey: string; apiKey: string }) =>
      testProviderConnection(providerKey, apiKey),
    onSuccess: (data, vars) => {
      setTestResult(prev => ({ ...prev, [vars.providerKey]: data }));
      if (data.ok) {
        toast.success(`Connected! Found ${data.modelsCount} models`);
      } else {
        toast.error(data.error || 'Connection failed');
      }
      setTestingKey(null);
    },
    onError: (e, vars) => {
      setTestResult(prev => ({ ...prev, [vars.providerKey]: { ok: false, error: e instanceof Error ? e.message : 'Failed' } }));
      toast.error('Connection test failed');
      setTestingKey(null);
    },
  });

  const saveMut = useMutation({
    mutationFn: (data: { providerKey: string; displayName: string; apiKey: string; baseUrl: string }) =>
      createProvider({
        providerKey: data.providerKey,
        displayName: data.displayName,
        apiKeyEnc: data.apiKey,
        baseUrl: data.baseUrl,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-providers'] });
      toast.success('Provider saved');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to save'),
  });

  const importMut = useMutation({
    mutationFn: ({ models, providerKey }: { models: FetchedModel[]; providerKey: string }) =>
      importModels(models, providerKey),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-models'] });
      toast.success(`Imported ${data.imported} models (${data.skipped} already existed)`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Import failed'),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteProvider(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-providers'] });
      toast.success('Provider removed');
    },
  });

  const catalogEntries = catalog ? Object.entries(catalog) : [];

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Sparkles className="h-6 w-6" /> LLM Providers
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Connect AI providers by entering their API keys. The system will fetch available models
          and let you select which ones to enable for users.
        </p>
      </div>

      {/* Connected providers summary */}
      {savedProviders && savedProviders.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connected Providers</h2>
          <div className="flex flex-wrap gap-2">
            {savedProviders.map(p => (
              <div key={p.providerId} className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/50 px-3 py-1.5 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                <span className="font-medium">{p.displayName}</span>
                <button
                  onClick={() => delMut.mutate(p.providerId)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Provider grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {catalogEntries.map(([key, entry]: [string, ProviderCatalogEntry]) => {
          const result = testResult[key];
          const isTesting = testingKey === key;
          const isSaved = savedProviders?.some(p => p.providerKey === key);
          const apiKey = apiKeyInputs[key] || '';

          return (
            <div key={key} className="border-border/60 bg-card/50 flex flex-col rounded-xl border p-4">
              {/* Header */}
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold">{entry.displayName}</h3>
                  <code className="text-muted-foreground text-xs">{key}</code>
                </div>
                {isSaved && (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-500">
                    <CheckCircle2 className="h-3 w-3" /> Saved
                  </span>
                )}
              </div>

              {/* API Key input */}
              <div className="mb-3">
                <label className="text-xs font-medium text-muted-foreground">API Key</label>
                <div className="mt-1 flex gap-2">
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKeyInputs(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder="Enter API key..."
                    className="text-xs"
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      setTestingKey(key);
                      testMut.mutate({ providerKey: key, apiKey });
                    }}
                    disabled={!apiKey.trim() || isTesting}
                    className="flex-shrink-0 text-xs"
                  >
                    {isTesting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Key className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Docs link */}
              <a
                href={entry.docs}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-3 flex items-center gap-1 text-xs text-blue-500 hover:underline"
              >
                Get API key <ExternalLink className="h-3 w-3" />
              </a>

              {/* Test result */}
              {result && (
                <div className={cn(
                  'mb-3 rounded-lg border p-3 text-xs',
                  result.ok
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : 'border-red-500/30 bg-red-500/5',
                )}>
                  {result.ok ? (
                    <div>
                      <div className="flex items-center gap-1.5 font-medium text-emerald-600">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Connected — {result.models?.length || 0} models found
                      </div>
                      {result.models && result.models.length > 0 && (
                        <div className="mt-2 max-h-32 overflow-y-auto">
                          {result.models.slice(0, 10).map(m => (
                            <div key={m.id} className="text-muted-foreground truncate font-mono text-xs">
                              {m.id}
                            </div>
                          ))}
                          {result.models.length > 10 && (
                            <div className="text-muted-foreground/60 mt-1 text-xs">
                              ...and {result.models.length - 10} more
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 font-medium text-red-600">
                      <XCircle className="h-3.5 w-3.5" />
                      {result.error || 'Connection failed'}
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              {result?.ok && result.models && result.models.length > 0 && (
                <div className="mt-auto flex gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => {
                      saveMut.mutate({
                        providerKey: key,
                        displayName: entry.displayName,
                        apiKey,
                        baseUrl: entry.baseUrl,
                      });
                      importMut.mutate({ models: result.models!, providerKey: key });
                    }}
                    disabled={saveMut.isPending || importMut.isPending}
                    className="flex-1 gap-1 text-xs"
                  >
                    {saveMut.isPending || importMut.isPending ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving...</>
                    ) : (
                      <><Download className="h-3.5 w-3.5" /> Save & Import Models</>
                    )}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
