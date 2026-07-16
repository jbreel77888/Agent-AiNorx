'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listSettings, updateSettings, publishPlatform, type PlatformSetting } from '@/lib/platform-admin-client';
import { SectionHeader, SectionContainer } from '../_components/section-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Settings, Loader2, Rocket, AlertCircle } from 'lucide-react';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export default function AdminSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading, isError } = useQuery({ queryKey: ['admin-settings'], queryFn: listSettings });

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
      const p = data.published;
      toast.success(
        `Published v${data.version} — ${p.sandboxesUpdated}/${p.sandboxesTotal} sandboxes updated` +
        (p.sandboxesFailed > 0 ? ` (${p.sandboxesFailed} failed)` : '')
      );
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

  const isBooleanSetting = (s: PlatformSetting) => {
    const v = getValue(s);
    return v === true || v === false || v === 'true' || v === 'false';
  };

  const isNumericSetting = (s: PlatformSetting) => {
    const v = getValue(s);
    return typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v));
  };

  const categories = Array.from(new Set(settings?.map(s => s.category || 'general') || []));

  return (
    <SectionContainer>
      <SectionHeader
        icon={Settings}
        title="Settings"
        description="Platform-wide settings. Changes take effect immediately after saving."
        actions={
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
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertCircle className="h-8 w-8 text-destructive/50 mb-3" />
          <p className="text-sm text-muted-foreground">Failed to load settings. Please try refreshing the page.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {categories.map(cat => (
            <div key={cat} className="space-y-3">
              <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">{cat}</h2>
              {settings?.filter(s => (s.category || 'general') === cat).map(s => {
                const val = getValue(s);
                const isBool = isBooleanSetting(s);
                const isNum = isNumericSetting(s);
                const isObj = typeof val === 'object' && val !== null;
                return (
                  <div key={s.key} className="border-border/60 bg-card/50 rounded-xl border p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <label className="text-sm font-medium">{s.key}</label>
                        {s.description && (
                          <p className="text-muted-foreground mt-0.5 text-xs">{s.description}</p>
                        )}
                      </div>
                      {isBool ? (
                        <Switch
                          checked={val === true || val === 'true'}
                          onCheckedChange={(checked) => setDrafts(prev => ({ ...prev, [s.key]: String(checked) }))}
                        />
                      ) : isObj ? (
                        <Textarea
                          value={typeof val === 'string' ? val : JSON.stringify(val, null, 2)}
                          onChange={(e) => setDrafts(prev => ({ ...prev, [s.key]: e.target.value }))}
                          className="w-64 flex-shrink-0 font-mono text-xs"
                          rows={4}
                        />
                      ) : (
                        <Input
                          type={isNum ? 'number' : 'text'}
                          value={String(val ?? '')}
                          onChange={(e) => setDrafts(prev => ({ ...prev, [s.key]: e.target.value }))}
                          className="w-64 flex-shrink-0"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
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
    </SectionContainer>
  );
}
