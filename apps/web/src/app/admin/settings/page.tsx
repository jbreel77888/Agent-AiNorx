'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listSettings, updateSettings, publishPlatform, type PlatformSetting } from '@/lib/platform-admin-client';
import { Button } from '@/components/ui/button';
import { Settings, Loader2, Rocket } from 'lucide-react';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export default function AdminSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery({ queryKey: ['admin-settings'], queryFn: listSettings });

  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const saveMut = useMutation({
    mutationFn: (updates: Array<{ key: string; value: unknown }>) => updateSettings(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      toast.success('Settings saved');
      setDrafts({});
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const publishMut = useMutation({
    mutationFn: () => publishPlatform(),
    onSuccess: (data) => {
      toast.success(`Published — v${data.version} (${data.published.agents} agents, ${data.published.models} models)`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Publish failed'),
  });

  const getValue = (s: PlatformSetting) => {
    if (drafts[s.key] !== undefined) return drafts[s.key];
    if (typeof s.value === 'string') {
      try { return JSON.parse(s.value); } catch { return s.value; }
    }
    return JSON.stringify(s.value);
  };

  const categories = Array.from(new Set(settings?.map(s => s.category || 'general') || []));

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Settings className="h-6 w-6" /> Settings
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Platform-wide settings. Changes take effect immediately after saving.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="default"
            onClick={() => publishMut.mutate()}
            disabled={publishMut.isPending}
            className="gap-2"
          >
            {publishMut.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Publishing...</>
            ) : (
              <><Rocket className="h-4 w-4" /> Publish Changes</>
            )}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          {categories.map(cat => (
            <div key={cat} className="space-y-3">
              <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">{cat}</h2>
              {settings?.filter(s => (s.category || 'general') === cat).map(s => (
                <div key={s.key} className="border-border/60 bg-card/50 rounded-xl border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <label className="text-sm font-medium">{s.key}</label>
                      {s.description && (
                        <p className="text-muted-foreground mt-0.5 text-xs">{s.description}</p>
                      )}
                    </div>
                    <input
                      type="text"
                      value={typeof getValue(s) === 'boolean' ? String(getValue(s)) : typeof getValue(s) === 'object' ? JSON.stringify(getValue(s)) : String(getValue(s) ?? '')}
                      onChange={(e) => setDrafts(prev => ({ ...prev, [s.key]: e.target.value }))}
                      className="border-input bg-background w-64 flex-shrink-0 rounded-md border px-3 py-1.5 text-sm"
                    />
                  </div>
                </div>
              ))}
            </div>
          ))}
          {Object.keys(drafts).length > 0 && (
            <div className="sticky bottom-0 flex justify-end gap-2 pt-4">
              <Button variant="ghost" onClick={() => setDrafts({})}>Cancel</Button>
              <Button
                onClick={() => {
                  const updates = Object.entries(drafts).map(([key, val]) => {
                    let parsed: unknown = val;
                    try { parsed = JSON.parse(val); } catch {}
                    return { key, value: parsed };
                  });
                  saveMut.mutate(updates);
                }}
                disabled={saveMut.isPending}
              >
                {saveMut.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
