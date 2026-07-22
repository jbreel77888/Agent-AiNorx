'use client';

import { Bell, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function NotificationsPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3 md:px-6 md:py-4">
        <h1 className="text-lg font-semibold">Notifications</h1>
        <p className="text-muted-foreground text-sm">
          Task completion, platform updates, and session events
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-3xl">
          <Card>
            <CardContent className="py-12">
              <div className="text-muted-foreground text-center">
                <Bell className="mx-auto mb-3 h-10 w-10 opacity-40" />
                <p className="text-sm">No notifications yet</p>
                <p className="mt-1 text-xs">You'll see session completions, trigger results, and platform updates here</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
