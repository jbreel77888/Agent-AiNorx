'use client';

/**
 * SectionHeader — a slim header bar with a leading icon + title, an optional
 * count badge, and an optional actions slot pinned right.
 *
 * Originally lived in `components/projects/customize/customize-section-header.tsx`
 * as the header for every Customize section. Moved to `components/common/` in
 * Phase 7.2.8 because it's a generic UI primitive used outside the (now-deleted)
 * Customize overlay (e.g. the Marketplace view).
 */

import type { LucideIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function SectionHeader({
  icon: Icon,
  title,
  count,
  actions,
  className,
}: {
  icon: LucideIcon;
  title: string;
  /** Optional count badge — hidden when null/undefined or 0. */
  count?: number | null;
  /** Right-aligned actions (buttons, etc.). */
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-4',
        className,
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
        {title}
      </h1>
      {typeof count === 'number' && count > 0 && (
        <Badge variant="secondary" size="sm" className="tabular-nums">
          {count}
        </Badge>
      )}
      {actions}
    </div>
  );
}

/** Backward-compat alias for callers that still import `CustomizeSectionHeader`. */
export const CustomizeSectionHeader = SectionHeader;
