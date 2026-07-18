'use client';

import { TunnelOverview } from '@/components/tunnel/tunnel-overview';

export default function ComputersPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3 md:px-6 md:py-4">
        <h1 className="text-lg font-semibold">My Computers</h1>
        <p className="text-muted-foreground text-sm">
          Connect your local machine so the agent can securely reach your files, shell, and desktop.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <TunnelOverview />
      </div>
    </div>
  );
}
