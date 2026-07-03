'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  listModels, createModel, updateModel, deleteModel, setDefaultModel,
  type PlatformModel,
} from '@/lib/platform-admin-client';
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
import { Cpu, Plus, Trash2, Pencil, Star, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

export default function AdminModelsPage() {
  const queryClient = useQueryClient();
  const { data: models, isLoading } = useQuery({
    queryKey: ['admin-models'],
    queryFn: listModels,
  });

  const [editing, setEditing] = useState<PlatformModel | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: (data: Partial<PlatformModel>) => createModel(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-models'] });
      toast.success('Model created');
      setCreating(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PlatformModel> }) =>
      updateModel(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-models'] });
      toast.success('Model updated');
      setEditing(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteModel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-models'] });
      toast.success('Model deleted');
      setDeleteId(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const defaultMut = useMutation({
    mutationFn: (id: string) => setDefaultModel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-models'] });
      toast.success('Default model set — all new sessions will use this model');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Cpu className="h-6 w-6" /> Models
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage model catalog. The default model is used for ALL user sessions.
            Users cannot see or switch models. To add models from a provider,
            go to <a href="/admin/llm-providers" className="text-blue-500 hover:underline">LLM Providers</a> to connect and fetch models.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Add Model Manually
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !models || models.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          No models yet. Go to{' '}
          <a href="/admin/llm-providers" className="text-blue-500 hover:underline">LLM Providers</a>
          {' '}to connect a provider and fetch models automatically, or click "Add Model Manually".
        </div>
      ) : (
        <div className="space-y-3">
          {models.map((model) => (
            <div
              key={model.modelId}
              className="border-border/60 bg-card/50 flex items-start gap-4 rounded-xl border p-4"
            >
              <div className="bg-primary/10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg">
                <Cpu className="text-primary h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{model.displayName}</h3>
                  {model.isDefault && (
                    <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-500">
                      <Star className="h-3 w-3" /> Default
                    </span>
                  )}
                  <span className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    model.isActive
                      ? 'bg-emerald-500/15 text-emerald-500'
                      : 'bg-muted text-muted-foreground',
                  )}>
                    {model.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  Key: <code className="bg-muted px-1 rounded">{model.modelKey}</code>
                  {' · '}Provider: {model.provider}
                  {model.upstreamModelId && (
                    <>{' · '}Upstream: <code className="bg-muted px-1 rounded">{model.upstreamModelId}</code></>
                  )}
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                {!model.isDefault && model.isActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => defaultMut.mutate(model.modelId)}
                    disabled={defaultMut.isPending}
                    className="gap-1 text-xs"
                  >
                    <Star className="h-3.5 w-3.5" /> Set Default
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(model)}
                  className="text-xs"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteId(model.modelId)}
                  className="text-muted-foreground hover:text-destructive text-xs"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <ModelEditor
          model={editing}
          onSave={(data) => {
            if (editing) {
              updateMut.mutate({ id: editing.modelId, data });
            } else {
              createMut.mutate(data);
            }
          }}
          onClose={() => { setCreating(false); setEditing(null); }}
          isPending={createMut.isPending || updateMut.isPending}
        />
      )}

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this model?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the model from the catalog. Make sure it's not the default.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => deleteId && deleteMut.mutate(deleteId)}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ModelEditor({ model, onSave, onClose, isPending }: {
  model: PlatformModel | null;
  onSave: (data: Partial<PlatformModel>) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const [modelKey, setModelKey] = useState(model?.modelKey || '');
  const [displayName, setDisplayName] = useState(model?.displayName || '');
  const [provider, setProvider] = useState(model?.provider || 'anthropic');
  const [upstreamModelId, setUpstreamModelId] = useState(model?.upstreamModelId || '');
  const [isDefault, setIsDefault] = useState(model?.isDefault || false);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{model ? 'Edit Model' : 'New Model'}</DialogTitle>
          <DialogDescription>
            Configure a model for the platform. The default model is used by all user sessions.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <label className="text-sm font-medium">Model Key</label>
            <Input
              value={modelKey}
              onChange={(e) => setModelKey(e.target.value)}
              placeholder="e.g. claude-sonnet-4.6"
              className="mt-1"
            />
            <p className="text-muted-foreground mt-1 text-xs">Unique identifier used in the gateway.</p>
          </div>
          <div>
            <label className="text-sm font-medium">Display Name</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Claude Sonnet 4.6"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="bedrock">AWS Bedrock</option>
              <option value="openrouter">OpenRouter</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Upstream Model ID (optional)</label>
            <Input
              value={upstreamModelId}
              onChange={(e) => setUpstreamModelId(e.target.value)}
              placeholder="e.g. us.anthropic.claude-sonnet-4-6"
              className="mt-1"
            />
            <p className="text-muted-foreground mt-1 text-xs">The actual model ID at the provider.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="rounded"
            />
            Set as default model (used for all user sessions)
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSave({ modelKey, displayName, provider, upstreamModelId, isDefault })}
            disabled={!modelKey.trim() || !displayName.trim() || isPending}
          >
            {isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
