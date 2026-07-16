'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import {
  listSkills, createSkill, updateSkill, deleteSkill,
  type PlatformSkill,
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
import { FileCode, Plus, Trash2, Pencil, Loader2, Search, AlertCircle } from 'lucide-react';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

export default function AdminSkillsPage() {
  const queryClient = useQueryClient();
  const { data: skills, isLoading, isError } = useQuery({ queryKey: ['admin-skills'], queryFn: listSkills });

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PlatformSkill | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

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
    return skills.filter((s) => s.slug.toLowerCase().includes(q));
  }, [skills, search]);

  return (
    <SectionContainer>
      <SectionHeader
        icon={FileCode}
        title="Skills"
        description="Manage skill definitions available to agents in sessions."
        actions={
          <Button onClick={() => setCreating(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Add Skill
          </Button>
        }
      />

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills..."
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
          <p className="text-sm text-muted-foreground">Failed to load skills. Please try refreshing the page.</p>
        </div>
      ) : !filteredSkills || filteredSkills.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          {search ? 'No skills match your search.' : 'No skills yet. Click "Add Skill" to create one.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredSkills.map(skill => (
            <div key={skill.skillId} className="border-border/60 bg-card/50 flex items-start gap-4 rounded-xl border p-4">
              <div className="bg-primary/10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg">
                <FileCode className="text-primary h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{skill.name}</h3>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium',
                    skill.isActive ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground')}>
                    {skill.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  Slug: <code className="bg-muted px-1 rounded">{skill.slug}</code>
                  {' · '}v{skill.version}
                </p>
                {skill.description && (
                  <p className="text-muted-foreground mt-1 text-xs">{skill.description}</p>
                )}
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditing(skill)} className="text-xs">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleteId(skill.skillId)}
                  className="text-muted-foreground hover:text-destructive text-xs">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
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
            <AlertDialogDescription>This will remove the skill from all sessions.</AlertDialogDescription>
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
