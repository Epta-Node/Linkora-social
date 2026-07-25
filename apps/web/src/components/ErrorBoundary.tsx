"use client";

/**
 * ErrorBoundary.tsx
 *
 * A reusable React class component that catches rendering errors anywhere
 * in its child tree, categorizes them, and displays a friendly fallback UI
 * with a "Try again" button that resets the boundary.
 *
 * Error classification delegates to `lib/errorClassifier.ts`.
 * Full error details are logged via console.error(); stack traces are
 * never exposed in the UI.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomeComponent />
 *   </ErrorBoundary>
 *
 *   // Custom reset callback:
 *   <ErrorBoundary onReset={() => router.refresh()}>
 *     <SomeComponent />
 *   </ErrorBoundary>
 *
 *   // Custom fallback override:
 *   <ErrorBoundary fallback={<p>Something broke</p>}>
 *     <SomeComponent />
 *   </ErrorBoundary>
 */

import React, { Component } from "react";
import type { CSSProperties, ErrorInfo, ReactNode } from "react";
import { classifyError } from "@/lib/errorClassifier";
import type { ErrorCategory } from "@/lib/errorClassifier";

// ---------------------------------------------------------------------------
// Props & State
// ---------------------------------------------------------------------------

export interface ErrorBoundaryProps {
  /** Content to render when no error has occurred. */
  children: ReactNode;
  /** Optional fully custom fallback that overrides the built-in UI. */
  fallback?: ReactNode;
  /** Optional callback invoked after the boundary successfully resets. */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorCategory: ErrorCategory;
}

// ---------------------------------------------------------------------------
// Category copy
// ---------------------------------------------------------------------------

const CATEGORY_CONFIG: Record<
  ErrorCategory,
  { heading: string; message: string; illustration: ReactNode }
> = {
  network: {
    heading: "Connection Problem",
    message: "We couldn't reach the server. Check your internet connection and try again.",
    illustration: <NetworkIllustration />,
  },
  contract: {
    heading: "Blockchain Error",
    message:
      "Something went wrong with the blockchain transaction or wallet. Please try again or check your wallet connection.",
    illustration: <ContractIllustration />,
  },
  general: {
    heading: "Something Went Wrong",
    message: "An unexpected error occurred. Our team has been notified. Please try again.",
    illustration: <GeneralIllustration />,
  },
};

// ---------------------------------------------------------------------------
// ErrorBoundary class component
// ---------------------------------------------------------------------------

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  /** Required by @types/react v19 stricter class component types. */
  declare refs: Record<string, React.ReactInstance>;

  /** Ref so we can focus the heading for screen readers on mount of fallback. */
  private headingRef = React.createRef<HTMLHeadingElement>();

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorCategory: "general" };
    this.resetError = this.resetError.bind(this);
  }

  // Called during render when a descendant throws.
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
      errorCategory: classifyError(error),
    };
  }

  // Called after the render phase; safe to perform side-effects here.
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary] Caught a rendering error:", error, errorInfo);
  }

  componentDidUpdate(_prevProps: ErrorBoundaryProps, prevState: ErrorBoundaryState): void {
    // Focus the heading when the fallback first mounts so screen readers
    // immediately announce the error.
    if (!prevState.hasError && this.state.hasError) {
      this.headingRef.current?.focus();
    }
  }

  resetError(): void {
    this.setState({ hasError: false, error: null, errorCategory: "general" });
    this.props.onReset?.();
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    // Allow a completely custom fallback to bypass built-in UI.
    if (this.props.fallback) {
      return this.props.fallback;
    }

    const { heading, message, illustration } = CATEGORY_CONFIG[this.state.errorCategory];

    return (
      <main style={styles.main}>
        <div role="alert" aria-live="assertive" aria-atomic="true" style={styles.card}>
          {/* Illustration */}
          <div style={styles.illustrationWrap} aria-hidden="true">
            {illustration}
          </div>

          {/* Heading — receives focus for a11y */}
          <h1 ref={this.headingRef} tabIndex={-1} style={styles.heading}>
            {heading}
          </h1>

          {/* User-friendly message — no stack traces */}
          <p style={styles.message}>{message}</p>

          {/* Try again button */}
          <button
            type="button"
            onClick={this.resetError}
            style={styles.button}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--color-primary-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--color-primary)";
            }}
          >
            Try again
          </button>
        </div>
      </main>
    );
  }
}

// ---------------------------------------------------------------------------
// Inline SVG Illustrations
// (Inline keeps the boundary self-contained and renders even if CSS fails)
// ---------------------------------------------------------------------------

function NetworkIllustration() {
  return (
    <svg
      width="80"
      height="80"
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Signal bars with slash */}
      <circle cx="40" cy="40" r="38" fill="var(--color-info-light, #dbeafe)" />
      <rect
        x="18"
        y="52"
        width="8"
        height="12"
        rx="2"
        fill="var(--color-info, #3b82f6)"
        opacity="0.4"
      />
      <rect
        x="30"
        y="44"
        width="8"
        height="20"
        rx="2"
        fill="var(--color-info, #3b82f6)"
        opacity="0.6"
      />
      <rect
        x="42"
        y="34"
        width="8"
        height="30"
        rx="2"
        fill="var(--color-info, #3b82f6)"
        opacity="0.8"
      />
      <rect x="54" y="22" width="8" height="42" rx="2" fill="var(--color-info, #3b82f6)" />
      {/* Diagonal cross-out */}
      <line
        x1="14"
        y1="14"
        x2="66"
        y2="66"
        stroke="var(--color-error, #ef4444)"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ContractIllustration() {
  return (
    <svg
      width="80"
      height="80"
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Broken chain link */}
      <circle cx="40" cy="40" r="38" fill="var(--color-primary-light, #ede9fe)" />
      {/* Left link */}
      <path
        d="M22 36 C22 28 30 24 36 28 L36 36"
        stroke="var(--color-primary, #7c3aed)"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M22 44 C22 52 30 56 36 52 L36 44"
        stroke="var(--color-primary, #7c3aed)"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Gap */}
      <line
        x1="36"
        y1="36"
        x2="36"
        y2="44"
        stroke="var(--color-primary, #7c3aed)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="3 5"
      />
      {/* Right link */}
      <path
        d="M58 36 C58 28 50 24 44 28 L44 36"
        stroke="var(--color-primary, #7c3aed)"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M58 44 C58 52 50 56 44 52 L44 44"
        stroke="var(--color-primary, #7c3aed)"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
      <line
        x1="44"
        y1="36"
        x2="44"
        y2="44"
        stroke="var(--color-primary, #7c3aed)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="3 5"
      />
      {/* Break indicator */}
      <line
        x1="36"
        y1="40"
        x2="44"
        y2="40"
        stroke="var(--color-error, #ef4444)"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GeneralIllustration() {
  return (
    <svg
      width="80"
      height="80"
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Warning triangle */}
      <circle cx="40" cy="40" r="38" fill="var(--color-warning-light, #fef3c7)" />
      <path d="M40 18 L66 62 H14 L40 18Z" fill="var(--color-warning, #f59e0b)" opacity="0.25" />
      <path
        d="M40 20 L64 60 H16 L40 20Z"
        stroke="var(--color-warning, #f59e0b)"
        strokeWidth="3.5"
        strokeLinejoin="round"
        fill="none"
      />
      <line
        x1="40"
        y1="35"
        x2="40"
        y2="50"
        stroke="var(--color-neutral-700, #374151)"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <circle cx="40" cy="57" r="2.5" fill="var(--color-neutral-700, #374151)" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Styles — inline CSSProperties + CSS custom properties
// (Mirrors the not-found.tsx pattern; works even if Tailwind fails to load)
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  main: {
    minHeight: "60vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "var(--space-xl, 32px)",
  },
  card: {
    maxWidth: "440px",
    width: "100%",
    textAlign: "center",
    background: "var(--color-bg, #ffffff)",
    border: "1px solid var(--color-border, #e5e7eb)",
    borderRadius: "16px",
    padding: "var(--space-2xl, 48px) var(--space-xl, 32px)",
    boxShadow: "0 4px 24px 0 rgba(0,0,0,0.06)",
  },
  illustrationWrap: {
    display: "flex",
    justifyContent: "center",
    marginBottom: "var(--space-lg, 24px)",
  },
  heading: {
    fontSize: "1.5rem",
    fontWeight: 700,
    color: "var(--color-text-primary, #111827)",
    marginBottom: "var(--space-sm, 8px)",
    letterSpacing: "-0.02em",
    outline: "none",
  },
  message: {
    color: "var(--color-text-secondary, #6b7280)",
    lineHeight: 1.65,
    marginBottom: "var(--space-xl, 32px)",
    fontSize: "0.95rem",
  },
  button: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0.625rem 1.75rem",
    background: "var(--color-primary, #7c3aed)",
    color: "#fff",
    borderRadius: "0.75rem",
    fontWeight: 600,
    fontSize: "0.95rem",
    border: "none",
    cursor: "pointer",
    transition: "background 0.15s",
  },
};

export default ErrorBoundary;
