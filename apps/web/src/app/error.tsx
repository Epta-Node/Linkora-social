"use client";

import React from "react";

/**
 * app/error.tsx — Next.js App Router route-level error boundary
 *
 * Next.js automatically wraps each route segment with this component
 * when it's present.  We delegate directly to ErrorBoundary's fallback
 * UI so the visuals stay consistent across the whole application.
 *
 * The `reset` function provided by Next.js re-renders the route segment;
 * we pass it as the `onReset` callback so the "Try again" button also
 * triggers a full route re-render rather than just a React state reset.
 *
 * Note: This file must be a Client Component ("use client") because
 * Next.js requires route-level error boundaries to be client components.
 */

import { useEffect } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";

interface NextErrorProps {
  /** The Error object caught by Next.js. */
  error: Error & { digest?: string };
  /** Callback to attempt re-rendering the failing route segment. */
  reset: () => void;
}

/**
 * Route-level error boundary for Next.js App Router.
 * Wraps the segment's subtree automatically when placed in app/.
 */
export default function RouteError({ error, reset }: NextErrorProps) {
  useEffect(() => {
    // Log to console so ops tooling / Sentry can pick it up.
    console.error("[RouteError] Unhandled route error:", error);
  }, [error]);

  return (
    /*
     * We reuse ErrorBoundary purely as a presentational wrapper here.
     * The actual error is already caught by Next.js; we just need to
     * render a consistent fallback UI with an onReset tied to Next's reset.
     */
    <ErrorBoundary onReset={reset}>
      {/* Force the ErrorBoundary into its fallback state immediately by
          throwing inside a child. We do this by creating a minimal component
          that always throws the captured error on first render. */}
      <AlwaysThrows error={error} />
    </ErrorBoundary>
  );
}

/** Internal component that rethrows the captured Next.js error so that
 *  ErrorBoundary's getDerivedStateFromError / componentDidCatch fire.
 *  Return type is `never` because execution always reaches a throw. */
function AlwaysThrows({ error }: { error: Error }): never {
  throw error;
}
