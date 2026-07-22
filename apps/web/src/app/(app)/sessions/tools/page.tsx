'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Clock,
  Link2,
  Store,
  Plug,
  Monitor,
  Bell,
  Settings,
  Rocket,
  ChevronRight,
} from 'lucide-react';
import { useTunnelConnections } from '@/hooks/tunnel/use-tunnel';
import { listSessions } from '@/lib/sessions-client';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface ToolCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
  badge?: string;
  badgeVariant?: 'default' | 'secondary' | 'destructive' | 'outline';
  disabled?: boolean;
  comingSoon?: boolean;
}

function ToolCard({ icon, title, description, href, badge, badgeVariant = 'secondary', disabled, comingSoon }: ToolCardProps) {
  const router = useRouter();
  return (
    <button
      onClick={() => !disabled && !comingSoon && router.push(href)}
      disabled={disabled || comingSoon}
      className={cn(
        'group relative flex flex-col items-start gap-3 rounded-xl border p-5 text-left transition-all',
        disabled || comingSoon
          ? 'cursor-not-allowed opacity-60'
          : 'hover:border-primary/50 hover:shadow-md cursor-pointer',
      )}
    >
      <div className="flex w-full items-center justify-between">
        <div className="bg-primary/10 text-primary flex h-10 w-10 items-center justify-center rounded-lg">
          {icon}
        </div>
        {badge && (
          <Badge variant={badgeVariant} className="text-xs">
            {badge}
          </Badge>
        )}
        {comingSoon && (
          <Badge variant="outline" className="text-xs">
            Coming Soon
          </Badge>
        )}
      </div>
      <div className="flex-1">
        <h3 className="flex items-center gap-1 text-sm font-semibold">
          {title}
          {!disabled && !comingSoon && (
            <ChevronRight className="text-muted-foreground h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </h3>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          {description}
        </p>
      </div>
    </button>
  );
}

export default function ToolsPage() {
  const { data: connections } = useTunnelConnections();
  const { data: sessions } = useQuery({
    queryKey: ['sessions'],
    queryFn: listSessions,
    staleTime: 30_000,
  });

  const onlineComputers = (connections ?? []).filter((c) => c.status === 'online').length;
  const totalComputers = connections?.length ?? 0;
  const activeSessions = (sessions ?? []).filter((s: any) => s.status === 'active' || s.status === 'running').length;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-4 md:px-6 md:py-5">
        <h1 className="text-xl font-semibold">Tools</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          All platform features in one place
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border p-3">
            <div className="text-2xl font-bold">{activeSessions}</div>
            <div className="text-muted-foreground text-xs">Active Sessions</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-2xl font-bold">{onlineComputers}</div>
            <div className="text-muted-foreground text-xs">Online Computers</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-2xl font-bold">{totalComputers}</div>
            <div className="text-muted-foreground text-xs">Total Computers</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-2xl font-bold">—</div>
            <div className="text-muted-foreground text-xs">Scheduled Tasks</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ToolCard
            icon={<Clock className="h-5 w-5" />}
            title="Scheduled Tasks"
            description="Schedule automated tasks that run at specific times — daily reports, cleanup, updates"
            href="/sessions/scheduled-tasks"
          />
          <ToolCard
            icon={<Link2 className="h-5 w-5" />}
            title="Setup Links"
            description="Manage setup links created by the agent for API keys and connections"
            href="/sessions/setup-links"
          />
          <ToolCard
            icon={<Monitor className="h-5 w-5" />}
            title="My Computers"
            description="Connect and manage your local machines — file access, shell, and desktop control"
            href="/sessions/computers"
            badge={onlineComputers > 0 ? `${onlineComputers} online` : undefined}
            badgeVariant={onlineComputers > 0 ? 'default' : 'secondary'}
          />
          <ToolCard
            icon={<Plug className="h-5 w-5" />}
            title="Connectors"
            description="Manage external connections — Gmail, Slack, GitHub, and more"
            href="/connectors"
          />
          <ToolCard
            icon={<Store className="h-5 w-5" />}
            title="Marketplace"
            description="Browse and install ready-made skills to extend agent capabilities"
            href="/marketplace"
          />
          <ToolCard
            icon={<Bell className="h-5 w-5" />}
            title="Notifications"
            description="Task completion, platform updates, and session events"
            href="/sessions/notifications"
          />
          <ToolCard
            icon={<Rocket className="h-5 w-5" />}
            title="Deployments"
            description="Deploy web apps from your session to a public URL instantly"
            href="/sessions/deployments"
          />
          <ToolCard
            icon={<Settings className="h-5 w-5" />}
            title="Settings"
            description="Account settings, API keys, security, and preferences"
            href="/sessions/settings"
          />
        </div>

        <div className="mt-8">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Quick Links</h2>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => window.location.href = '/sessions'}
              className="hover:bg-accent rounded-lg border px-3 py-1.5 text-xs transition-colors"
            >
              All Sessions
            </button>
            <button
              onClick={() => window.location.href = '/sessions/computers'}
              className="hover:bg-accent rounded-lg border px-3 py-1.5 text-xs transition-colors"
            >
              Connect New Computer
            </button>
            <button
              onClick={() => window.location.href = '/connectors'}
              className="hover:bg-accent rounded-lg border px-3 py-1.5 text-xs transition-colors"
            >
              Add Connector
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
