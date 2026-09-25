import { fetchWithTimeout } from "../utils/fetch";
import { TimeoutError } from "../errors";

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
          init?.signal?.addEventListener("abort", () =>
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
