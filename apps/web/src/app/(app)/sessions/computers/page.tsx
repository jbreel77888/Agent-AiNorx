'use client';

import { TunnelOverview } from '@/components/tunnel/tunnel-overview';
import { PageHeader } from '@/components/ui/page-header';
import { useTranslations } from 'next-intl';

export default function ComputersPage() {
  const t = useTranslations('hardcodedUi');
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="My Computers"
        description="Connect your local machine so the agent can securely reach your files, shell, and desktop over a permissioned reverse tunnel."
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <TunnelOverview />
      </div>
    </div>
  );
}
