'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import {
  listSkills, createSkill, updateSkill, deleteSkill,
  seedSkills, reinstallSkill, toggleSkill, publishPlatform,
  type PlatformSkill,
} from '@/lib/platform-admin-client';
import { listMarketplaceItems } from '@/lib/marketplace-client';
import { SectionHeader, SectionContainer } from '../_components/section-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  FileCode, Plus, Trash2, Pencil, Loader2, Search, AlertCircle,
  Rocket, RefreshCw, Power, CheckCircle2, XCircle, Database, Sparkles,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

type Tab = 'installed' | 'available';

export default function AdminSkillsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('installed');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PlatformSkill | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Installed (platform_skills) query
  const { data: skills, isLoading: skillsLoading, isError: skillsError } = useQuery({
    queryKey: ['admin-skills'],
    queryFn: listSkills,
  });

  // Available (marketplace) query
  const { data: marketplaceItems, isLoading: marketplaceLoading } = useQuery({
    queryKey: ['admin-marketplace-available'],
    queryFn: () => listMarketplaceItems(),
    enabled: tab === 'available',
  });

  // Seed mutation
  const seedMut = useMutation({
    mutationFn: () => seedSkills(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-skills'] });
      toast.success(data.message || `Seeded ${data.inserted} skills`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Seed failed'),
  });

  // Publish mutation
  const publishMut = useMutation({
    mutationFn: () => publishPlatform(),
    onSuccess: (data) => {
      toast.success(`Published v${data.version} — ${data.published.sandboxesUpdated}/${data.published.sandboxesTotal} sandboxes updated`);
      queryClient.invalidateQueries({ queryKey: ['admin-skills'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Publish failed'),
  });

  // Reinstall mutation
  const reinstallMut = useMutation({
    mutationFn: (id: string) => reinstallSkill(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-skills'] });
      toast.success('Skill reinstalled from scaffold');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Reinstall failed'),
  });

  // Toggle (enable/disable) mutation
  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => toggleSkill(id, isActive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-skills'] });
      toast.success('Skill updated');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  // Save mutation (create + edit)
  const saveMut = useMutation({
    mutationFn: (data: { id?: string; body: Partial<PlatformSkill> }) =>
      data.id ? updateSkill(data.id, data.body) : createSkill(data.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-skills'] });
      toast.success('Skill saved');
      setEditing(null); setCreating(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  // Delete mutation
  const delMut = useMutation({
    mutationFn: (id: string) => deleteSkill(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-skills'] });
      toast.success('Skill deleted'); setDeleteId(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const filteredSkills = useMemo(() => {
    if (!skills) return [];
    if (!search.trim()) return skills;
    const q = search.toLowerCase();
    return skills.filter((s) =>
      s.slug.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
  }, [skills, search]);

  const filteredMarketplace = useMemo(() => {
    if (!marketplaceItems) return [];
    const items = marketplaceItems.items ?? [];
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((item: { title?: string; id?: string }) =>
      item.title?.toLowerCase().includes(q) || item.id?.toLowerCase().includes(q)
    );
  }, [marketplaceItems, search]);

  const activeCount = skills?.filter(s => s.isActive).length ?? 0;
  const totalCount = skills?.length ?? 0;

  return (
    <SectionContainer>
      <SectionHeader
        icon={FileCode}
        title="Skills"
        description="Manage skill definitions available to agents in sessions."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => seedMut.mutate()}
              disabled={seedMut.isPending}
              className="gap-2"
              title="Seed platform skills from the baked scaffold (69 default skills)"
            >
              {seedMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
              Seed Defaults
            </Button>
            <Button
              onClick={() => publishMut.mutate()}
              disabled={publishMut.isPending}
              className="gap-2"
              title="Push all active skills to every active sandbox immediately"
            >
              {publishMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Publish
            </Button>
            <Button onClick={() => setCreating(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Add Skill
            </Button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b">
        <button
          onClick={() => setTab('installed')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'installed'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          Installed ({totalCount})
        </button>
        <button
          onClick={() => setTab('available')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'available'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          Available in Marketplace
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-md mt-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${tab === 'installed' ? 'skills' : 'marketplace'}...`}
          className="pl-9"
        />
      </div>

      {/* Stats banner for installed tab */}
      {tab === 'installed' && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            {activeCount} active
          </Badge>
          <Badge variant="outline" className="gap-1">
            <XCircle className="h-3 w-3 text-muted-foreground" />
            {totalCount - activeCount} disabled
          </Badge>
        </div>
      )}

      {/* Content */}
      {tab === 'installed' ? (
        skillsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : skillsError ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-8 w-8 text-destructive/50 mb-3" />
            <p className="text-sm text-muted-foreground">Failed to load skills. Please try refreshing the page.</p>
          </div>
        ) : !filteredSkills || filteredSkills.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
            {search ? 'No skills match your search.' : (
              <div className="space-y-3">
                <p>No skills yet.</p>
                <p className="text-xs">Click <strong>Seed Defaults</strong> above to import the 69 built-in skills, or <strong>Add Skill</strong> to create one manually.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => seedMut.mutate()}
                  disabled={seedMut.isPending}
                  className="gap-2"
                >
                  {seedMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Database className="h-3 w-3" />}
                  Seed Default Skills
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSkills.map(skill => (
              <div key={skill.skillId} className="border-border/60 bg-card/50 flex items-start gap-4 rounded-xl border p-4">
                <div className="bg-primary/10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg">
                  <FileCode className="text-primary h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold">{skill.name}</h3>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium',
                      skill.isActive ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground')}>
                      {skill.isActive ? 'Active' : 'Disabled'}
                    </span>
                    <span className="text-xs text-muted-foreground">v{skill.version}</span>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Slug: <code className="bg-muted px-1 rounded">{skill.slug}</code>
                  </p>
                  {skill.description && (
                    <p className="text-muted-foreground mt-1 text-xs line-clamp-2">{skill.description}</p>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  {/* Enable/Disable toggle */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleMut.mutate({ id: skill.skillId, isActive: !skill.isActive })}
                    disabled={toggleMut.isPending}
                    className="text-xs"
                    title={skill.isActive ? 'Disable' : 'Enable'}
                  >
                    {skill.isActive ? (
                      <Power className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Power className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </Button>
                  {/* Reinstall from scaffold */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => reinstallMut.mutate(skill.skillId)}
                    disabled={reinstallMut.isPending}
                    className="text-xs"
                    title="Reinstall from scaffold (revert edits)"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                  {/* Edit */}
                  <Button variant="ghost" size="sm" onClick={() => setEditing(skill)} className="text-xs">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {/* Delete */}
                  <Button variant="ghost" size="sm" onClick={() => setDeleteId(skill.skillId)}
                    className="text-muted-foreground hover:text-destructive text-xs">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        /* Available tab — marketplace browse */
        marketplaceLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !filteredMarketplace || filteredMarketplace.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
            {search ? 'No marketplace items match your search.' : 'No marketplace items available.'}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredMarketplace.map((item: any) => {
              // Check if this item is already installed as a platform skill
              const installedSkill = skills?.find(s => s.slug === item.id || s.name === item.title);
              return (
                <div key={item.id} className="border-border/60 bg-card/50 flex items-start gap-4 rounded-xl border p-4">
                  <div className="bg-primary/10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg">
                    <Sparkles className="text-primary h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold">{item.title || item.id}</h3>
                      {item.type && (
                        <Badge variant="outline" className="text-xs">{item.type}</Badge>
                      )}
                      {installedSkill && (
                        <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs">
                          Already installed
                        </Badge>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-muted-foreground mt-1 text-xs line-clamp-2">{item.description}</p>
                    )}
                    {item.source?.address && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        Source: <code className="bg-muted px-1 rounded">{item.source.address}</code>
                      </p>
                    )}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {installedSkill ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled
                        className="text-xs"
                      >
                        Installed
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1"
                        title="Install as a platform skill (available to all accounts)"
                        onClick={() => {
                          // For now, link to the marketplace page where admin can install
                          window.open('/marketplace', '_blank');
                        }}
                      >
                        <Plus className="h-3 w-3" />
                        Install
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {(creating || editing) && (
        <SkillEditor skill={editing}
          onSave={(body) => saveMut.mutate({ id: editing?.skillId, body })}
          onClose={() => { setCreating(false); setEditing(null); }}
          isPending={saveMut.isPending} />
      )}

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this skill?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the skill from all sessions.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={() => deleteId && delMut.mutate(deleteId)} disabled={delMut.isPending}>
              {delMut.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionContainer>
  );
}

function SkillEditor({ skill, onSave, onClose, isPending }: {
  skill: PlatformSkill | null;
  onSave: (data: Partial<PlatformSkill>) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const [slug, setSlug] = useState(skill?.slug || '');
  const [name, setName] = useState(skill?.name || '');
  const [description, setDescription] = useState(skill?.description || '');
  const [skillContent, setSkillContent] = useState(skill?.skillContent || '');

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{skill ? 'Edit Skill' : 'New Skill'}</DialogTitle>
          <DialogDescription>Define a skill's SKILL.md content.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <label className="text-sm font-medium">Slug</label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="e.g. vaelorx-system" className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. VaelorX System" className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">Skill Content (SKILL.md)</label>
            <textarea value={skillContent} onChange={(e) => setSkillContent(e.target.value)}
              className="border-input bg-background mt-1 min-h-[300px] w-full rounded-md border px-3 py-2 font-mono text-xs"
              placeholder="---&#10;description: ...&#10;mode: primary&#10;---&#10;&#10;Skill instructions..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave({ slug, name, description, skillContent })}
            disabled={!slug.trim() || !name.trim() || !skillContent.trim() || isPending}>
            {isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
