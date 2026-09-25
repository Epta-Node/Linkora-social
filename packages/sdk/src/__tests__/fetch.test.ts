import { fetchWithRetry, fetchWithTimeout, type FetchRetryOptions } from "../utils/fetch";
import { RetryExhaustedError, TimeoutError } from "../errors";

describe("fetchWithTimeout (issue #1344)", () => {
  const fetchMock = jest.fn<Promise<Response>, [string | URL, RequestInit | undefined]>();

  beforeEach(() => {
    fetchMock.mockReset();
    jest.spyOn(global, "fetch").mockImplementation(fetchMock as unknown as typeof fetch);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Fetch that hangs until the request signal it receives aborts. */
  function hangingFetch(): void {
    fetchMock.mockImplementation(
      (_url: string | URL, init: RequestInit | undefined) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return;
          if (signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
        })
    );
  }

  it("cancels the request when the caller-supplied AbortSignal fires", async () => {
    hangingFetch();
    const caller = new AbortController();
    const pending = fetchWithTimeout("https://api.example.com", { signal: caller.signal }, 5_000);

    await Promise.resolve();
    caller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    // A caller abort must not be converted into an internal timeout error.
    await expect(pending).rejects.not.toBeInstanceOf(TimeoutError);
  });

  it("cancels immediately when the caller signal is already aborted", async () => {
    hangingFetch();
    const caller = new AbortController();
    caller.abort();

    const pending = fetchWithTimeout("https://api.example.com", { signal: caller.signal }, 5_000);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps the timeout working when a caller signal is present but never aborts", async () => {
    hangingFetch();
    const caller = new AbortController();
    const pending = fetchWithTimeout("https://api.example.com", { signal: caller.signal }, 10);

    await expect(pending).rejects.toBeInstanceOf(TimeoutError);
    expect(caller.signal.aborted).toBe(false);
  });

  it("still applies the timeout when no caller signal is given", async () => {
    hangingFetch();
    const pending = fetchWithTimeout("https://api.example.com", undefined, 10);

    await expect(pending).rejects.toBeInstanceOf(TimeoutError);
  });

  it("passes the caller signal through unchanged when the timeout is disabled", async () => {
    fetchMock.mockResolvedValue({ ok: true } as Response);
    const caller = new AbortController();

    await fetchWithTimeout("https://api.example.com", { signal: caller.signal }, 0);

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com", {
      signal: caller.signal,
    });
  });
});

describe("fetchWithRetry (issue #1363)", () => {
  const fetchMock = jest.fn<Promise<Response>, [string | URL, RequestInit | undefined]>();

  beforeEach(() => {
    fetchMock.mockReset();
    jest.spyOn(global, "fetch").mockImplementation(fetchMock as unknown as typeof fetch);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const failing = (attempts: number): void => {
    let rejected = 0;
    fetchMock.mockImplementation(() => {
      if (rejected < attempts) {
        rejected += 1;
        return Promise.reject(new Error(`ECONNREFUSED (attempt ${rejected})`));
      }
      return Promise.resolve({ ok: true } as Response);
    });
  };

  it("retries an idempotent read with backoff until it recovers", async () => {
    failing(2);
    const retries: Array<[number, number]> = [];
    const options: FetchRetryOptions = {
      baseDelayMs: 5,
      maxDelayMs: 20,
      onRetry: (attempt, delayMs) => retries.push([attempt, delayMs]),
    };

    const response = await fetchWithRetry(
      "https://api.example.com",
      undefined,
      5_000,
      options
    );

    expect(response).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(retries).toEqual([
      [1, 5],
      [2, 10],
    ]);
  });

  it("does not retry non-idempotent methods unless opted in", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      fetchWithRetry("https://api.example.com", { method: "POST" }, 5_000, {
        baseDelayMs: 1,
      })
    ).rejects.not.toBeInstanceOf(RetryExhaustedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    await expect(
      fetchWithRetry(
        "https://api.example.com",
        { method: "POST" },
        5_000,
        { idempotent: true, retries: 1, baseDelayMs: 1 }
      )
    ).rejects.toBeInstanceOf(RetryExhaustedError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops retrying when the caller aborts the request", async () => {
    const caller = new AbortController();
    fetchMock.mockImplementation(
      (_url: string | URL, init: RequestInit | undefined) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return;
          if (signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
        })
    );

    caller.abort();
    const pending = fetchWithRetry(
      "https://api.example.com",
      { signal: caller.signal },
      5_000,
      { retries: 3, baseDelayMs: 1 }
    );

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(pending).rejects.not.toBeInstanceOf(RetryExhaustedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("raises RetryExhaustedError with the attempt count when all attempts fail", async () => {
    failing(99);
    const retries: number[] = [];
    const options: FetchRetryOptions = {
      retries: 2,
      baseDelayMs: 1,
      onRetry: (attempt) => retries.push(attempt),
    };

    await expect(
      fetchWithRetry("https://api.example.com", undefined, 10, options)
    ).rejects.toMatchObject({ code: "RETRY_EXHAUSTED", details: { attempts: 3 } });
    expect(retries).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("caps excessive retry requests at the hard bound", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      fetchWithRetry("https://api.example.com", undefined, 10, {
        retries: 100,
        baseDelayMs: 1,
      })
    ).rejects.toBeInstanceOf(RetryExhaustedError);

    // 5 retries (the hard cap) + the initial attempt.
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
