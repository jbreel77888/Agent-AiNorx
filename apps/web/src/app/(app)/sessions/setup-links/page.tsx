'use client';

import { useQuery } from '@tanstack/react-query';
import { Link2, Copy, Clock, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { getEnv } from '@/lib/env-config';
import { useAuth } from '@/features/providers/auth-provider';

export default function SetupLinksPage() {
  const { user } = useAuth();

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3 md:px-6 md:py-4">
        <h1 className="text-lg font-semibold">Setup Links</h1>
        <p className="text-muted-foreground text-sm">
          Setup links created by the agent for API keys and connections
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Info card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Link2 className="h-4 w-4" />
                How Setup Links Work
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>When the agent needs an API key or connection credential, it creates a short-lived setup link.</p>
              <p>The link is valid for 30 minutes. Open it in your browser, enter the required values, and they are securely saved to your account.</p>
              <p>The agent never sees your secrets — it only knows the field names it requested.</p>
            </CardContent>
          </Card>

          {/* Active links would go here — for now show placeholder */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Active Links</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-muted-foreground py-8 text-center text-sm">
                <Link2 className="mx-auto mb-2 h-8 w-8 opacity-40" />
                No active setup links. Ask the agent to connect a service
                and it will create one for you.
              </div>
            </CardContent>
          </Card>

          {/* How to use */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">How to Use</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              <div className="flex gap-3">
                <div className="bg-primary/10 text-primary flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold">1</div>
                <p className="text-muted-foreground pt-0.5">Tell the agent what you need (e.g. "I need an OpenAI API key")</p>
              </div>
              <div className="flex gap-3">
                <div className="bg-primary/10 text-primary flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold">2</div>
                <p className="text-muted-foreground pt-0.5">The agent creates a secure setup link and shares it with you</p>
              </div>
              <div className="flex gap-3">
                <div className="bg-primary/10 text-primary flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold">3</div>
                <p className="text-muted-foreground pt-0.5">Open the link, enter your credentials, and they are saved securely</p>
              </div>
              <div className="flex gap-3">
                <div className="bg-primary/10 text-primary flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold">4</div>
                <p className="text-muted-foreground pt-0.5">The agent can now use the credential in your session</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
