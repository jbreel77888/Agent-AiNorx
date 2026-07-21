'use client';

/**
 * Board page — simplified for session-only mode.
 *
 * The ticket/task/milestone system was project-scoped and has been removed.
 * This page now shows a simple message directing users to sessions.
 */

export default function BoardPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <div className="text-center">
        <h2 className="text-lg font-semibold">Board</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          The ticket board is no longer available in session-only mode.
          Use sessions to manage your work directly.
        </p>
      </div>
    </div>
  );
}
