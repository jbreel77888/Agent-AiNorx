'use client';

import { useQuery } from '@tanstack/react-query';
import { Container } from 'lucide-react';

import { useAdminRole } from '@/hooks/admin';
import { getProject } from '@/lib/projects-client';
import { SandboxSnapshotCard } from '@/components/projects/sandbox-snapshot-card';
import { CustomizeSectionHeader } from '@/components/projects/customize/customize-section-header';

/**
 * Customize → Sandbox. The project's runtime image: per-commit snapshots that
 * every session boots from, their health, retention, and recovery (Retry /
 * Fix with agent). Env vars live under Secrets; this surface owns the image.
 * Warm pool is configured per template, inline on each row in the templates card.
 *
 * ⚠️ HIDDEN from regular users — admin only. Moved to admin panel for SaaS.
 */

export function SandboxView({ projectId }: { projectId: string }) {
  // Admin-only guard — regular users should never reach this view
  const { data: adminRoleData } = useAdminRole();
  const isAdmin = adminRoleData?.isAdmin ?? false;

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
    staleTime: 20_000,
  });
  const canManage = projectQuery.data?.effective_project_role === 'manager';

  if (!isAdmin) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <CustomizeSectionHeader icon={Container} title="Sandbox" />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-muted-foreground text-sm">This section is available for administrators only.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <CustomizeSectionHeader icon={Container} title="Sandbox" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
          <SandboxSnapshotCard projectId={projectId} canManage={!!canManage} />
        </div>
      </div>
    </div>
  );
}
