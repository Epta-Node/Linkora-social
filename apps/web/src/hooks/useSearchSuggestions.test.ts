import { renderHook, act, waitFor } from '@testing-library/react';
import { useSearchSuggestions } from './useSearchSuggestions';

const mockFetch = jest.fn();

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

/** Let the trailing-edge debounce timer (300ms default) fire. */
async function flushDebounce() {
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
}

describe('useSearchSuggestions', () => {
  it('returns no suggestions for a query below the minimum length', async () => {
    const { result } = renderHook(() => useSearchSuggestions());

    act(() => {
      result.current.fetchSuggestions('a');
    });

    expect(result.current.suggestions).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fires a leading-edge request immediately and maps profiles to suggestions', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        profiles: [
          { address: 'GALICE', username: 'alice', display_name: 'Alice' },
          { address: 'GBOB', username: 'bob' },
        ],
      })
    );

    const { result } = renderHook(() => useSearchSuggestions());
    act(() => {
      result.current.fetchSuggestions('al');
    });

    await waitFor(() => {
      expect(result.current.suggestions).toEqual([
        { type: 'profile', value: 'GALICE', displayName: 'Alice', avatar: undefined },
        { type: 'profile', value: 'GBOB', displayName: 'bob', avatar: undefined },
      ]);
    });
    expect(result.current.loading).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('accepts a bare array payload from the indexer', async () => {
    mockFetch.mockResolvedValue(jsonResponse([{ address: 'GALICE', username: 'alice' }]));

    const { result } = renderHook(() => useSearchSuggestions());
    act(() => {
      result.current.fetchSuggestions('al');
    });

    await waitFor(() => {
      expect(result.current.suggestions).toHaveLength(1);
    });
  });

  it('truncates the profile list to maxSuggestions', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        profiles: [
          { address: 'GA' },
          { address: 'GB' },
          { address: 'GC' },
        ],
      })
    );

    const { result } = renderHook(() => useSearchSuggestions({ maxSuggestions: 2 }));
    act(() => {
      result.current.fetchSuggestions('a1');
    });

    await waitFor(() => {
      expect(result.current.suggestions).toHaveLength(2);
    });
  });

  it('prepends a hashtag suggestion for a query starting with #', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ profiles: [] }));

    const { result } = renderHook(() => useSearchSuggestions());
    act(() => {
      result.current.fetchSuggestions('#stellar');
    });

    await waitFor(() => {
      expect(result.current.suggestions).toEqual([
        { type: 'hashtag', value: '#stellar', displayName: '#stellar' },
      ]);
    });
  });

  it('clears suggestions and clears loading when the indexer returns an error status', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, false));

    const { result } = renderHook(() => useSearchSuggestions());
    act(() => {
      result.current.fetchSuggestions('al');
    });

    await waitFor(() => {
      expect(result.current.suggestions).toEqual([]);
      expect(result.current.loading).toBe(false);
    });
  });

  it('clears suggestions when the request rejects', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error('API failed'));

    const { result } = renderHook(() => useSearchSuggestions());
    act(() => {
      result.current.fetchSuggestions('al');
    });

    await waitFor(() => {
      expect(result.current.suggestions).toEqual([]);
      expect(result.current.loading).toBe(false);
    });
    (console.error as jest.Mock).mockRestore();
  });

  it('resets suggestions and loading state on clearSuggestions()', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ profiles: [{ address: 'GALICE' }] }));

    const { result } = renderHook(() => useSearchSuggestions());
    act(() => {
      result.current.fetchSuggestions('al');
    });
    await waitFor(() => {
      expect(result.current.suggestions).toHaveLength(1);
    });

    act(() => {
      result.current.clearSuggestions();
    });

    expect(result.current.suggestions).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('aborts the in-flight request on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockFetch.mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
      capturedSignal = init?.signal;
      return new Promise(() => {});
    });

    const { result, unmount } = renderHook(() => useSearchSuggestions());
    act(() => {
      result.current.fetchSuggestions('al');
    });

    expect(capturedSignal?.aborted).toBe(false);
    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });
});

describe('useSearchSuggestions debounce', () => {
  it('does not re-request an already executed query on the trailing edge', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ profiles: [{ address: 'GALICE' }] }));

    const { result } = renderHook(() => useSearchSuggestions());
    act(() => {
      result.current.fetchSuggestions('alice');
    });

    await waitFor(() => {
      expect(result.current.suggestions).toHaveLength(1);
    });

    await flushDebounce();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('issues a trailing-edge request for a query that arrived during the debounce window', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ profiles: [] }));

    const { result } = renderHook(() => useSearchSuggestions());
    act(() => {
      result.current.fetchSuggestions('al');
    });
    act(() => {
      result.current.fetchSuggestions('alice');
    });

    await flushDebounce();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});