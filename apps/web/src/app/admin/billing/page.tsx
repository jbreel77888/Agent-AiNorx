'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listPlans, createPlan, updatePlan, deletePlan,
  type PlatformPlan,
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
import { CreditCard, Plus, Trash2, Pencil, Loader2, Search, AlertCircle } from 'lucide-react';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useState, useMemo } from 'react';

export default function AdminBillingPage() {
  const queryClient = useQueryClient();
  const { data: plans, isLoading, isError } = useQuery({ queryKey: ['admin-plans'], queryFn: listPlans });

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PlatformPlan | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const saveMut = useMutation({
    mutationFn: (data: { id?: string; body: Partial<PlatformPlan> }) =>
      data.id ? updatePlan(data.id, data.body) : createPlan(data.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-plans'] });
      toast.success('Plan saved');
      setEditing(null); setCreating(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deletePlan(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-plans'] });
      toast.success('Plan deleted'); setDeleteId(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const filteredPlans = useMemo(() => {
    if (!plans) return [];
    if (!search.trim()) return plans;
    const q = search.toLowerCase();
    return plans.filter((p) => p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q));
  }, [plans, search]);

  return (
    <SectionContainer>
      <SectionHeader
        icon={CreditCard}
        title="Billing Plans"
        description="Manage subscription plans. Prices are monthly in USD."
        actions={
          <Button onClick={() => setCreating(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Add Plan
          </Button>
        }
      />

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search plans..."
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
          <p className="text-sm text-muted-foreground">Failed to load billing plans. Please try refreshing the page.</p>
        </div>
      ) : !filteredPlans || filteredPlans.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          {search ? 'No plans match your search.' : 'No plans yet. Click "Add Plan" to create one.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredPlans.map((plan) => (
            <div key={plan.planId} className="border-border/60 bg-card/50 flex items-start gap-4 rounded-xl border p-4">
              <div className="bg-primary/10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg">
                <CreditCard className="text-primary h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{plan.name}</h3>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium',
                    plan.isActive ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground')}>
                    {plan.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  ${plan.priceMonthlyUsd / 100}/mo · Slug: <code className="bg-muted px-1 rounded">{plan.slug}</code>
                </p>
                {plan.description && (
                  <p className="text-muted-foreground mt-1 text-xs">{plan.description}</p>
                )}
                {plan.features && (
                  <pre className="text-muted-foreground/60 mt-1 text-xs">{JSON.stringify(plan.features, null, 2)}</pre>
                )}
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditing(plan)} className="text-xs">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm"
                  onClick={() => setDeleteId(plan.planId)}
                  className="text-muted-foreground hover:text-destructive text-xs">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <PlanEditor plan={editing}
          onSave={(body) => saveMut.mutate({ id: editing?.planId, body })}
          onClose={() => { setCreating(false); setEditing(null); }}
          isPending={saveMut.isPending} />
      )}

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this plan?</AlertDialogTitle>
            <AlertDialogDescription>Existing subscribers will keep their current plan.</AlertDialogDescription>
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

function PlanEditor({ plan, onSave, onClose, isPending }: {
  plan: PlatformPlan | null;
  onSave: (data: Partial<PlatformPlan>) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const [slug, setSlug] = useState(plan?.slug || '');
  const [name, setName] = useState(plan?.name || '');
  const [price, setPrice] = useState(plan ? String(plan.priceMonthlyUsd / 100) : '');
  const [description, setDescription] = useState(plan?.description || '');
  const [features, setFeatures] = useState(plan?.features ? JSON.stringify(plan.features, null, 2) : '{}');

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{plan ? 'Edit Plan' : 'New Plan'}</DialogTitle>
          <DialogDescription>Configure a subscription plan.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <label className="text-sm font-medium">Slug</label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="e.g. pro" className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pro" className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">Price (USD/month)</label>
            <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 20" type="number" className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Plan description" className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">Features (JSON)</label>
            <textarea value={features} onChange={(e) => setFeatures(e.target.value)}
              className="border-input bg-background mt-1 min-h-[120px] w-full rounded-md border px-3 py-2 font-mono text-xs"
              placeholder='{"maxSessions": 100, "maxConcurrentSandboxes": 3}' />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => {
            try {
              const parsed = JSON.parse(features);
              onSave({ slug, name, priceMonthlyUsd: Math.round(parseFloat(price) * 100), description, features: parsed });
            } catch {
              toast.error('Invalid JSON in features');
            }
          }} disabled={!slug.trim() || !name.trim() || isPending}>
            {isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
