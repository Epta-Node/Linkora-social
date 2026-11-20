import { retryWithBackoff, WALLET_RETRY_DELAYS_MS } from "../retryWithBackoff";

describe("retryWithBackoff", () => {
  it("retries with 500ms, 1s and 2s delays before giving up", async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const onRetry = jest.fn();
    const fn = jest.fn().mockRejectedValue(new Error("not ready"));

    await expect(
      retryWithBackoff(fn, { delaysMs: WALLET_RETRY_DELAYS_MS, sleep, onRetry })
    ).rejects.toThrow("not ready");
    expect(fn).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000, 2000]);
    expect(onRetry.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 3]);
  });

  it("resolves as soon as an attempt succeeds", async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const fn = jest.fn().mockRejectedValueOnce(new Error("not ready")).mockResolvedValue("ok");
    await expect(retryWithBackoff(fn, { delaysMs: [500, 1000, 2000], sleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("does not retry errors that shouldRetry rejects", async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const fn = jest.fn().mockRejectedValue(new Error("declined"));
    await expect(
      retryWithBackoff(fn, { delaysMs: [500], sleep, shouldRetry: () => false })
    ).rejects.toThrow("declined");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
