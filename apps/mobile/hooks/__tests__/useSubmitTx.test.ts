/**
 * useSubmitTx.test.ts
 *
 * Guards against issue #1298: submitTx must sign with the connected wallet,
 * broadcast via sendTransaction, poll getTransaction, and return the real
 * on-chain hash — never a hard-coded "mock-tx:" string or random hex.
 */

import { renderHook, act } from "@testing-library/react-native";
import { useSubmitTx } from "../useSubmitTx";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Variable names must be prefixed with "mock" to be accessible inside jest.mock()
// factories (Jest hoists jest.mock() calls before variable declarations).
const mockShowPending = jest.fn();
const mockShowSuccess = jest.fn();
const mockShowError = jest.fn();

jest.mock("../../context/ToastContext", () => ({
  useToast: () => ({
    showPending: mockShowPending,
    showSuccess: mockShowSuccess,
    showError: mockShowError,
  }),
}));

// NetworkContext — provide a fake RPC URL so we can intercept fetch
const FAKE_RPC_URL = "https://rpc.test.example";

jest.mock("../../context/NetworkContext", () => ({
  useNetworkContext: () => ({
    rpcUrl: FAKE_RPC_URL,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REAL_TX_HASH = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
const SIGNED_XDR =
  "AAAAAgAAAABSZWFsU2lnbmVkWERSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

/**
 * Install a fake walletKit on globalThis that signs successfully.
 */
function installFakeWalletKit(
  opts: {
    signedXdr?: string;
    failSign?: boolean;
  } = {}
) {
  const { signedXdr = SIGNED_XDR, failSign = false } = opts;

  (
    globalThis as { __LINKORA_WALLET_KIT__?: unknown }
  ).__LINKORA_WALLET_KIT__ = {
    signTransaction: jest.fn(async () => {
      if (failSign) throw new Error("User rejected signing");
      return { signedTxXdr: signedXdr };
    }),
  };
}

function clearFakeWalletKit() {
  delete (globalThis as { __LINKORA_WALLET_KIT__?: unknown }).__LINKORA_WALLET_KIT__;
}

/**
 * Build a fetch mock sequence:
 *   1st call → sendTransaction  → returns { hash, status: "PENDING" }
 *   2nd call → getTransaction   → returns { status: "NOT_FOUND" }   (first poll)
 *   3rd call → getTransaction   → returns { status: "SUCCESS" }     (confirmed)
 */
function mockFetchSequence(hash: string = REAL_TX_HASH) {
  let callCount = 0;
  global.fetch = jest.fn(async () => {
    callCount += 1;
    let result: unknown;

    if (callCount === 1) {
      // sendTransaction
      result = { hash, status: "PENDING" };
    } else if (callCount === 2) {
      // getTransaction — still pending
      result = { status: "NOT_FOUND" };
    } else {
      // getTransaction — confirmed
      result = { status: "SUCCESS" };
    }

    return {
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, result }),
    } as unknown as Response;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSubmitTx (#1298)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    clearFakeWalletKit();
    jest.useRealTimers();
  });

  // ── happy path ────────────────────────────────────────────────────────────

  it("returns the real on-chain hash when signing and broadcast succeed", async () => {
    installFakeWalletKit();
    mockFetchSequence(REAL_TX_HASH);

    const { result } = renderHook(() => useSubmitTx());
    let returnedHash: string | undefined;

    await act(async () => {
      const promise = result.current("some:tx:descriptor");
      // Advance timers so the polling setTimeout fires
      await jest.runAllTimersAsync();
      returnedHash = await promise;
    });

    expect(returnedHash).toBe(REAL_TX_HASH);
  });

  it("never returns a 'mock-tx:' prefixed hash", async () => {
    installFakeWalletKit();
    mockFetchSequence(REAL_TX_HASH);

    const { result } = renderHook(() => useSubmitTx());
    let returnedHash: string | undefined;

    await act(async () => {
      const promise = result.current("some:tx:descriptor");
      await jest.runAllTimersAsync();
      returnedHash = await promise;
    });

    expect(returnedHash).not.toMatch(/^mock-tx:/);
  });

  it("never returns a random 0x-prefixed hex hash", async () => {
    installFakeWalletKit();
    mockFetchSequence(REAL_TX_HASH);

    const { result } = renderHook(() => useSubmitTx());
    let returnedHash: string | undefined;

    await act(async () => {
      const promise = result.current("some:tx:descriptor");
      await jest.runAllTimersAsync();
      returnedHash = await promise;
    });

    // Random hex mocks look like `0x<Math.random().toString(16)…>`
    expect(returnedHash).not.toMatch(/^0x[0-9a-f]+$/i);
  });

  it("calls showPending before broadcast and showSuccess with the real hash", async () => {
    installFakeWalletKit();
    mockFetchSequence(REAL_TX_HASH);

    const { result } = renderHook(() => useSubmitTx());

    await act(async () => {
      const promise = result.current("some:tx:descriptor");
      await jest.runAllTimersAsync();
      await promise;
    });

    expect(mockShowPending).toHaveBeenCalledTimes(1);
    expect(mockShowSuccess).toHaveBeenCalledWith(REAL_TX_HASH);
  });

  it("passes the signed XDR to sendTransaction, not the original descriptor", async () => {
    installFakeWalletKit({ signedXdr: SIGNED_XDR });
    mockFetchSequence(REAL_TX_HASH);

    const { result } = renderHook(() => useSubmitTx());

    await act(async () => {
      const promise = result.current("my:descriptor");
      await jest.runAllTimersAsync();
      await promise;
    });

    // The first fetch call is sendTransaction; its body must contain the signed XDR
    const firstCall = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(firstCall[1].body as string) as {
      method: string;
      params: Array<{ transaction: string }>;
    };
    expect(body.method).toBe("sendTransaction");
    expect(body.params[0].transaction).toBe(SIGNED_XDR);
  });

  it("polls getTransaction until SUCCESS before resolving", async () => {
    installFakeWalletKit();
    mockFetchSequence(REAL_TX_HASH);

    const { result } = renderHook(() => useSubmitTx());

    await act(async () => {
      const promise = result.current("some:tx:descriptor");
      await jest.runAllTimersAsync();
      await promise;
    });

    // fetch should have been called 3 times: sendTx + 2× getTx (NOT_FOUND then SUCCESS)
    expect(global.fetch).toHaveBeenCalledTimes(3);
    const calls = (global.fetch as jest.Mock).mock.calls.map(
      (c) => (JSON.parse(c[1].body as string) as { method: string }).method
    );
    expect(calls).toEqual(["sendTransaction", "getTransaction", "getTransaction"]);
  });

  // ── error paths ───────────────────────────────────────────────────────────

  it("throws and calls showError when no wallet kit is installed", async () => {
    // No wallet kit installed
    clearFakeWalletKit();

    const { result } = renderHook(() => useSubmitTx());

    await act(async () => {
      await expect(result.current("some:tx:descriptor")).rejects.toThrow(
        /no wallet connected/i
      );
    });

    expect(mockShowError).toHaveBeenCalled();
    expect(mockShowSuccess).not.toHaveBeenCalled();
  });

  it("throws and calls showError when the user rejects signing", async () => {
    installFakeWalletKit({ failSign: true });

    const { result } = renderHook(() => useSubmitTx());

    await act(async () => {
      await expect(result.current("some:tx:descriptor")).rejects.toThrow(
        /user rejected signing/i
      );
    });

    expect(mockShowError).toHaveBeenCalledWith("User rejected signing");
  });

  it("throws and calls showError when sendTransaction returns an RPC error", async () => {
    installFakeWalletKit();

    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        error: { message: "bad sequence number" },
      }),
    })) as unknown as typeof fetch;

    const { result } = renderHook(() => useSubmitTx());

    await act(async () => {
      await expect(result.current("some:tx:descriptor")).rejects.toThrow(
        /bad sequence number/i
      );
    });

    expect(mockShowError).toHaveBeenCalled();
  });

  it("throws when getTransaction eventually reports FAILED", async () => {
    installFakeWalletKit();

    let callCount = 0;
    global.fetch = jest.fn(async () => {
      callCount += 1;
      const res =
        callCount === 1
          ? { hash: REAL_TX_HASH, status: "PENDING" }
          : { status: "FAILED" };
      return {
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: res }),
      } as unknown as Response;
    });

    const { result } = renderHook(() => useSubmitTx());

    await act(async () => {
      await jest.runAllTimersAsync();
      await expect(result.current("some:tx:descriptor")).rejects.toThrow(
        /transaction failed on-chain/i
      );
    });

    expect(mockShowError).toHaveBeenCalled();
  });
});
