'use client';

/**
 * Customize → Computers — the Agent Computer Tunnel surface.
 *
 * Connect a local machine and grant agents permissioned access to its files,
 * shell, and desktop over a reverse tunnel. This is an EXPERIMENTAL feature:
 * the rail entry only appears when a project has opted in
 * (Customize → Settings → Experimental → Agent Computer Tunnel), gated on
 * `project.experimental.agent_tunnel`.
 *
 * ⚠️ HIDDEN from regular users — admin only. Enterprise feature in SaaS model.
 *
 * Tunnels are account-scoped (a connected computer is reusable across your
 * projects); we surface the manager here so it lives alongside the rest of a
 * project's wiring. {@link TunnelOverview} brings its own page header.
 */

import { useAdminRole } from '@/hooks/admin';
import { Monitor } from 'lucide-react';
import { CustomizeSectionHeader } from '@/components/projects/customize/customize-section-header';
import { TunnelOverview } from '@/components/tunnel/tunnel-overview';

export function ComputersView({ projectId: _projectId }: { projectId: string }) {
  // Admin-only guard — regular users should never reach this view
  const { data: adminRoleData } = useAdminRole();
  const isAdmin = adminRoleData?.isAdmin ?? false;

  if (!isAdmin) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <CustomizeSectionHeader icon={Monitor} title="Computers" />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-muted-foreground text-sm">This section is available for administrators only.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
      <TunnelOverview />
    </div>
  );
}
