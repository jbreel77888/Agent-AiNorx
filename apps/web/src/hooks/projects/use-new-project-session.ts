/**
 * useNewProjectSession — STUB (Phase 7.2.8).
 *
 * The original hook created a new project-scoped session via
 * `createProjectSession` + `prefetchSessionStart` and navigated to
 * `/projects/[id]/sessions/[sessionId]`. Session-only mode uses
 * `createSession` from `@/lib/sessions-client` and navigates to
 * `/sessions/[sessionId]` directly (see command-palette's simple-mode branch).
 *
 * This stub returns a no-op so legacy callers keep compiling.
 */

export function useNewProjectSession(_projectId: string | undefined) {
  return (_opts?: { onNavigate?: (sessionId: string) => void; create?: { sandbox_slug?: string } }) => {
    // No-op — simple mode uses createSession from sessions-client directly.
  };
}
