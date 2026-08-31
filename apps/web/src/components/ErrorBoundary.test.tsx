/**
 * ErrorBoundary.test.tsx
 *
 * Tests for the reusable ErrorBoundary component.
 * Covers:
 *  1. Renders children normally (no error)
 *  2. Renders fallback UI when a child throws
 *  3. "Try again" button resets the boundary
 *  4. Network error shows network-specific message
 *  5. Contract/Web3 error shows contract-specific message
 *  6. Generic error shows generic fallback message
 *  7. console.error is called with full error details
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A component that throws on render when `shouldThrow` is true.
 * Allows us to toggle throwing between renders to test the reset path.
 */
function Bomb({ shouldThrow, message }: { shouldThrow: boolean; message?: string }) {
  if (shouldThrow) {
    throw new Error(message ?? "Unexpected render error");
  }
  return <div>Child rendered successfully</div>;
}

/**
 * Suppress React's "The above error occurred…" console.error during tests.
 * We spy on console.error ourselves and only care about our own call.
 */
let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// 1. Happy path — renders children when no error
// ---------------------------------------------------------------------------

describe("ErrorBoundary — normal rendering", () => {
  it("renders children when no error is thrown", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText("Child rendered successfully")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2. Renders fallback when a child throws
// ---------------------------------------------------------------------------

describe("ErrorBoundary — error fallback", () => {
  it("renders the fallback UI when a child throws a rendering error", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow message="Unexpected render error" />
      </ErrorBoundary>
    );

    // The fallback should be present
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Children must NOT be visible
    expect(screen.queryByText("Child rendered successfully")).not.toBeInTheDocument();

    // "Try again" button must be present
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("renders a custom fallback when the `fallback` prop is supplied", () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback content</div>}>
        <Bomb shouldThrow message="some error" />
      </ErrorBoundary>
    );

    expect(screen.getByText("Custom fallback content")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3. "Try again" button resets the boundary
// ---------------------------------------------------------------------------

describe("ErrorBoundary — retry / reset", () => {
  it("resets the boundary when the Try again button is clicked", () => {
    // Use a mutable ref object (not a primitive closure variable) so that
    // when ErrorBoundary calls resetError() and re-renders the stored
    // children JSX, the child component reads the *updated* value at
    // re-render time rather than the stale value captured at JSX-creation time.
    const throwRef = { current: true };

    function RefBomb() {
      if (throwRef.current) throw new Error("Unexpected render error");
      return <div>Child rendered successfully</div>;
    }

    render(
      <ErrorBoundary>
        <RefBomb />
      </ErrorBoundary>
    );

    // Fallback is shown
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Disable throwing BEFORE clicking retry so the next render succeeds
    throwRef.current = false;

    // Click retry — ErrorBoundary resets its state and re-renders RefBomb,
    // which now reads throwRef.current === false and renders normally.
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    // Fallback gone, children visible — no extra rerender() call needed
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Child rendered successfully")).toBeInTheDocument();
  });

  it("calls the onReset callback when the boundary resets", () => {
    const onReset = jest.fn();
    let shouldThrow = true;

    const { rerender } = render(
      <ErrorBoundary onReset={onReset}>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>
    );

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    rerender(
      <ErrorBoundary onReset={onReset}>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>
    );

    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Network error
// ---------------------------------------------------------------------------

describe("ErrorBoundary — network errors", () => {
  it("shows a network-specific message for fetch failures", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow message="Failed to fetch /api/profile" />
      </ErrorBoundary>
    );

    expect(screen.getByText(/connection problem/i)).toBeInTheDocument();
    expect(screen.getByText(/check your internet connection/i)).toBeInTheDocument();
  });

  it("shows a network-specific message for timeout errors", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow message="Request timeout after 30000ms" />
      </ErrorBoundary>
    );

    expect(screen.getByText(/connection problem/i)).toBeInTheDocument();
  });

  it("shows a network-specific message for connection errors", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow message="network error occurred" />
      </ErrorBoundary>
    );

    expect(screen.getByText(/connection problem/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 5. Contract / Web3 errors
// ---------------------------------------------------------------------------

describe("ErrorBoundary — contract / Web3 errors", () => {
  it("shows a blockchain message for contract execution failures", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow message="Contract execution failed: invoke error" />
      </ErrorBoundary>
    );

    expect(screen.getByText(/blockchain error/i)).toBeInTheDocument();
    expect(screen.getByText(/blockchain transaction or wallet/i)).toBeInTheDocument();
  });

  it("shows a blockchain message for Freighter wallet errors", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow message="Freighter extension rejected the request" />
      </ErrorBoundary>
    );

    expect(screen.getByText(/blockchain error/i)).toBeInTheDocument();
  });

  it("shows a blockchain message for Stellar transaction failures", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow message="Transaction simulation returned error" />
      </ErrorBoundary>
    );

    expect(screen.getByText(/blockchain error/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 6. Generic errors
// ---------------------------------------------------------------------------

describe("ErrorBoundary — generic errors", () => {
  it("shows a generic message for unknown runtime errors", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow message="Cannot read properties of undefined" />
      </ErrorBoundary>
    );

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/unexpected error occurred/i)).toBeInTheDocument();
  });

  it("shows a generic message for empty error messages", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow message="" />
      </ErrorBoundary>
    );

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 7. console.error logging
// ---------------------------------------------------------------------------

describe("ErrorBoundary — console logging", () => {
  it("calls console.error with the error and errorInfo when a child throws", () => {
    const testError = new Error("Unexpected render error for logging test");

    render(
      <ErrorBoundary>
        <Bomb shouldThrow message={testError.message} />
      </ErrorBoundary>
    );

    // console.error should have been called (at least once) with the error
    const errorCalls = consoleErrorSpy.mock.calls;

    // Find the call that includes our [ErrorBoundary] prefix
    const boundaryCall = errorCalls.find(
      (args: unknown[]) => typeof args[0] === "string" && args[0].includes("[ErrorBoundary]")
    );

    expect(boundaryCall).toBeDefined();
    // Second argument should be the Error instance
    expect(boundaryCall?.[1]).toBeInstanceOf(Error);
    expect((boundaryCall?.[1] as Error).message).toBe(testError.message);
  });

  it("does NOT expose stack trace in the UI", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow message="Some internal error" />
      </ErrorBoundary>
    );

    // The rendered DOM should not contain "at " (stack frame syntax)
    const alert = screen.getByRole("alert");
    expect(alert.textContent).not.toMatch(/at \w+ \(/);
  });
});
