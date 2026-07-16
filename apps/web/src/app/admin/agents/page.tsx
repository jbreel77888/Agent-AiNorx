'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import {
  listAgents, createAgent, updateAgent, deleteAgent, setDefaultAgent,
  type PlatformAgent,
} from '@/lib/platform-admin-client';
import { SectionHeader, SectionContainer } from '../_components/section-header';
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
import { Bot, Plus, Trash2, Pencil, Star, Loader2, Search, AlertCircle } from 'lucide-react';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

export default function AdminAgentsPage() {
  const queryClient = useQueryClient();
  const { data: agents, isLoading, isError } = useQuery({
    queryKey: ['admin-agents'],
    queryFn: listAgents,
  });

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PlatformAgent | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: (data: Partial<PlatformAgent>) => createAgent(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-agents'] });
      toast.success('Agent created');
      setCreating(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PlatformAgent> }) =>
      updateAgent(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-agents'] });
      toast.success('Agent updated');
      setEditing(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAgent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-agents'] });
      toast.success('Agent deleted');
      setDeleteId(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const defaultMut = useMutation({
    mutationFn: (id: string) => setDefaultAgent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-agents'] });
      toast.success('Default agent set');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const filteredAgents = useMemo(() => {
    if (!agents) return [];
    if (!search.trim()) return agents;
    const q = search.toLowerCase();
    return agents.filter(
      (a) => a.name.toLowerCase().includes(q) || (a.description ?? '').toLowerCase().includes(q),
    );
  }, [agents, search]);

  return (
    <SectionContainer>
      <SectionHeader
        icon={Bot}
        title="Agents"
        description="Manage agent definitions. Changes apply to new sessions immediately."
        actions={
          <Button onClick={() => setCreating(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Add Agent
          </Button>
        }
      />

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agents..."
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertCircle className="h-8 w-8 text-destructive/50 mb-3" />
          <p className="text-sm text-muted-foreground">Failed to load agents. Please try refreshing the page.</p>
        </div>
      ) : !filteredAgents || filteredAgents.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          {search ? 'No agents match your search.' : 'No agents yet. Click "Add Agent" to create one.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAgents.map((agent) => (
            <div
              key={agent.agentId}
              className="border-border/60 bg-card/50 flex items-start gap-4 rounded-xl border p-4"
            >
              <div className="bg-primary/10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg">
                <Bot className="text-primary h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{agent.name}</h3>
                  {agent.isDefault && (
                    <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                      <Star className="h-3 w-3" /> Default
                    </span>
                  )}
                  <span className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    agent.isActive
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-muted text-muted-foreground',
                  )}>
                    {agent.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                {agent.description && (
                  <p className="text-muted-foreground mt-1 text-xs">{agent.description}</p>
                )}
                <p className="text-muted-foreground/60 mt-1 text-xs">
                  Mode: {agent.mode} · v{agent.version} · Updated {new Date(agent.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                {!agent.isDefault && agent.isActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => defaultMut.mutate(agent.agentId)}
                    disabled={defaultMut.isPending}
                    className="gap-1 text-xs"
                  >
                    <Star className="h-3.5 w-3.5" /> Set Default
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(agent)}
                  className="text-xs"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteId(agent.agentId)}
                  className="text-muted-foreground hover:text-destructive text-xs"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit dialog */}
      {(creating || editing) && (
        <AgentEditor
          agent={editing}
          onSave={(data) => {
            if (editing) {
              updateMut.mutate({ id: editing.agentId, data });
            } else {
              createMut.mutate(data);
            }
          }}
          onClose={() => { setCreating(false); setEditing(null); }}
          isPending={createMut.isPending || updateMut.isPending}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this agent?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the agent definition. New sessions will no longer use it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => deleteId && deleteMut.mutate(deleteId)}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting...</>
              ) : 'Delete'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionContainer>
  );
}

function AgentEditor({ agent, onSave, onClose, isPending }: {
  agent: PlatformAgent | null;
  onSave: (data: Partial<PlatformAgent>) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const [name, setName] = useState(agent?.name || '');
  const [description, setDescription] = useState(agent?.description || '');
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt || '');
  const [isDefault, setIsDefault] = useState(agent?.isDefault || false);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{agent ? 'Edit Agent' : 'New Agent'}</DialogTitle>
          <DialogDescription>
            Define the agent's system prompt. This controls how the agent behaves in sessions.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. vaelorx, researcher, coder"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description of what this agent does"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium">System Prompt</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="---&#10;description: ...&#10;mode: primary&#10;permission:&#10;  &quot;*&quot;: allow&#10;---&#10;&#10;You are a VaelorX AI agent..."
              className="border-input bg-background mt-1 min-h-[300px] w-full rounded-md border px-3 py-2 font-mono text-xs"
            />
            <p className="text-muted-foreground mt-1 text-xs">
              Include YAML frontmatter (---...---) followed by the system prompt.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="rounded"
            />
            Set as default agent (used for all new sessions)
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSave({ name, description, systemPrompt, isDefault })}
            disabled={!name.trim() || !systemPrompt.trim() || isPending}
          >
            {isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</>
            ) : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
