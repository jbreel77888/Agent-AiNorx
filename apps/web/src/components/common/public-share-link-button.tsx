'use client';

import { useMutation } from '@tanstack/react-query';
import { Link2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { createSessionShare, type SessionShareInput } from '@/lib/sessions-client';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/**
 * PublicShareLinkButton — creates a public share link for a session.
 *
 * Uses the session-scoped /v1/sessions/:id/shares endpoint (no projectId needed).
 * Works in both project-mode and session-only mode.
 */
export function PublicShareLinkButton({
  sessionId,
  input,
  tooltip = 'Copy a public view-only link',
  title = 'Copy public link',
  className,
}: {
  /** Legacy prop — ignored in session-only mode. */
  projectId?: string;
  sessionId?: string;
  input: SessionShareInput | null;
  tooltip?: string;
  title?: string;
  className?: string;
}) {
  const share = useMutation({
    mutationFn: async () => {
      if (!sessionId || !input) {
        throw new Error('Nothing is selected to share');
      }
      const result = await createSessionShare(sessionId, input);
      if (!result.share.public_path) {
        throw new Error('Share link was not returned');
      }
      const publicUrl = `${window.location.origin}${result.share.public_path}`;
      await navigator.clipboard.writeText(publicUrl);
      return publicUrl;
    },
    onSuccess: () => {
      toast.success('Public link copied');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not create public link');
    },
  });

  const disabled = !sessionId || !input || share.isPending;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8', className)}
          onClick={() => share.mutate()}
          disabled={disabled}
          title={title}
        >
          {share.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Link2 className="h-4 w-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-56 text-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
