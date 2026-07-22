'use client';

import { Rocket, ExternalLink, Copy } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DeploymentsPage } from '@/components/deployments/deployments-page';

export default function DeploymentsRoute() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3 md:px-6 md:py-4">
        <h1 className="text-lg font-semibold">Deployments</h1>
        <p className="text-muted-foreground text-sm">
          Deploy web apps from your session to a public URL instantly
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <DeploymentsPage />
      </div>
    </div>
  );
}
