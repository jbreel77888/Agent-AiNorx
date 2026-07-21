'use client';

/**
 * Task detail page — simplified for session-only mode.
 * The task system was project-scoped and has been removed.
 */

export default function TaskDetailPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <div className="text-center">
        <h2 className="text-lg font-semibold">Tasks</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          The task system is no longer available in session-only mode.
          Use sessions to manage your work directly.
        </p>
      </div>
    </div>
  );
}
