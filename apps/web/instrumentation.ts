/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Used to initialize server-side Sentry for Better Stack error tracking.
 *
 * onRequestError captures errors from:
 * - Server Components
 * - Middleware
 * - Server-side proxies
 * These are NOT caught by app.onError() — they need this hook.
 */

import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Server-side Sentry init
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    // Edge runtime Sentry init
    await import('./sentry.edge.config');
  }
}

// Capture errors from Server Components, middleware, and proxies.
// This is the ONLY way to catch these — they bypass error.tsx boundaries.
export const onRequestError = Sentry.captureRequestError;
