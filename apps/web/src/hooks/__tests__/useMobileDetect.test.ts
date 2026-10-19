/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useMobileDetect, useMediaQuery } from "../useMobileDetect";

// ---------------------------------------------------------------------------
// Helpers to control window.matchMedia in jsdom
// ---------------------------------------------------------------------------

type MqlListener = (event: { matches: boolean }) => void;

interface MockMql {
  matches: boolean;
  addEventListener: jest.Mock;
  removeEventListener: jest.Mock;
  /** Simulate a viewport change by firing all registered listeners. */
  _fire(matches: boolean): void;
  /** The set of listeners currently attached. */
  _listeners: Set<MqlListener>;
}

function createMockMql(initialMatches: boolean): MockMql {
  const listeners = new Set<MqlListener>();

  const mql: MockMql = {
    matches: initialMatches,
    _listeners: listeners,
    addEventListener: jest.fn((_type: string, cb: MqlListener) => {
      listeners.add(cb);
    }),
    removeEventListener: jest.fn((_type: string, cb: MqlListener) => {
      listeners.delete(cb);
    }),
    _fire(matches: boolean) {
      mql.matches = matches;
      listeners.forEach((cb) => cb({ matches }));
    },
  };

  return mql;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useMobileDetect / useMediaQuery", () => {
  let mql: MockMql;

  beforeEach(() => {
    mql = createMockMql(false);
    // jest.setup.ts defines window.matchMedia as writable, so we can assign
    // directly without Object.defineProperty (which would throw "cannot
    // redefine non-configurable property" on subsequent calls).
    window.matchMedia = jest.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── initial value ──────────────────────────────────────────────────────────

  it("returns false when the query does not match on mount", () => {
    mql = createMockMql(false);
    (window.matchMedia as jest.Mock).mockReturnValue(mql);

    const { result } = renderHook(() => useMobileDetect());
    expect(result.current).toBe(false);
  });

  it("returns true when the query already matches on mount", () => {
    mql = createMockMql(true);
    (window.matchMedia as jest.Mock).mockReturnValue(mql);

    const { result } = renderHook(() => useMobileDetect());
    expect(result.current).toBe(true);
  });

  // ── media-query change ─────────────────────────────────────────────────────

  it("updates when the media query fires a change event", () => {
    mql = createMockMql(false);
    (window.matchMedia as jest.Mock).mockReturnValue(mql);

    const { result } = renderHook(() => useMobileDetect());
    expect(result.current).toBe(false);

    act(() => {
      mql._fire(true);
    });

    expect(result.current).toBe(true);
  });

  it("toggles back to false when the query stops matching", () => {
    mql = createMockMql(true);
    (window.matchMedia as jest.Mock).mockReturnValue(mql);

    const { result } = renderHook(() => useMobileDetect());
    expect(result.current).toBe(true);

    act(() => {
      mql._fire(false);
    });

    expect(result.current).toBe(false);
  });

  // ── listener lifecycle ─────────────────────────────────────────────────────

  it("adds exactly one listener on mount", () => {
    mql = createMockMql(false);
    (window.matchMedia as jest.Mock).mockReturnValue(mql);

    renderHook(() => useMobileDetect());

    expect(mql.addEventListener).toHaveBeenCalledTimes(1);
    expect(mql.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("removes the listener on unmount", () => {
    mql = createMockMql(false);
    (window.matchMedia as jest.Mock).mockReturnValue(mql);

    const { unmount } = renderHook(() => useMobileDetect());
    unmount();

    expect(mql.removeEventListener).toHaveBeenCalledTimes(1);
    // Confirm the same function reference was used for both add and remove.
    const addedCb = mql.addEventListener.mock.calls[0][1];
    const removedCb = mql.removeEventListener.mock.calls[0][1];
    expect(addedCb).toBe(removedCb);
  });

  it("does not fire updates after unmount", () => {
    mql = createMockMql(false);
    (window.matchMedia as jest.Mock).mockReturnValue(mql);

    const { result, unmount } = renderHook(() => useMobileDetect());
    unmount();

    // After unmount the listener set should be empty — _fire has no effect.
    act(() => {
      mql._fire(true);
    });

    // Value should remain what it was at unmount time.
    expect(result.current).toBe(false);
  });

  // ── query change ───────────────────────────────────────────────────────────

  it("re-subscribes and picks up the new snapshot when the query prop changes", () => {
    const mqlNarrow = createMockMql(true);  // (max-width: 600px) matches
    const mqlWide = createMockMql(false);   // (max-width: 1024px) does not match

    (window.matchMedia as jest.Mock).mockImplementation((q: string) =>
      q === "(max-width: 600px)" ? mqlNarrow : mqlWide,
    );

    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useMediaQuery(q),
      { initialProps: { q: "(max-width: 600px)" } },
    );

    expect(result.current).toBe(true);

    rerender({ q: "(max-width: 1024px)" });

    expect(result.current).toBe(false);
    // Old listener must have been removed.
    expect(mqlNarrow.removeEventListener).toHaveBeenCalledTimes(1);
    // New listener must have been added.
    expect(mqlWide.addEventListener).toHaveBeenCalledTimes(1);
  });
});
