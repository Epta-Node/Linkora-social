import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSearchSuggestions } from "./useSearchSuggestions";

describe("useSearchSuggestions Hook", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("handles leading edge immediate trigger and prevents race conditions", async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ profiles: [{ address: "G123", username: "alice" }] }),
      });
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() =>
      useSearchSuggestions({ debounceMs: 300, minQueryLength: 2, leadingEdge: true })
    );

    act(() => {
      result.current.fetchSuggestions("al");
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("q=al"),
      expect.anything()
    );

    // Fast subsequent keystroke within debounce window
    act(() => {
      result.current.fetchSuggestions("alice");
    });

    // Still only 1 call before timer expires
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Fast-forward debounce timer
    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    // Trailing call fires for final query
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenLastCalledWith(
      expect.stringContaining("q=alice"),
      expect.anything()
    );
  });

  it("clears suggestions when clearSuggestions is called", () => {
    const { result } = renderHook(() => useSearchSuggestions());

    act(() => {
      result.current.clearSuggestions();
    });

    expect(result.current.suggestions).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
