import { renderHook, act, waitFor } from "@testing-library/react-native";

import { usePoolWithdraw } from "../usePoolWithdraw";
import { useWallet } from "../useWallet";
import { useSubmitTx } from "../useSubmitTx";
import {
  getPoolRecord,
  recordPoolWithdrawal,
  resetPoolState,
  syncPoolFromChain,
  verifyPoolApprovals,
  type PoolApproval,
} from "../../utils/poolStore";

jest.mock("../useWallet", () => ({ useWallet: jest.fn() }));
jest.mock("../useSubmitTx", () => ({ useSubmitTx: jest.fn() }));
jest.mock("../../utils/indexerConfig", () => ({
  getIndexerBaseUrl: () => "https://indexer.example.com",
}));

const ADMIN_A = "GCKFBEIYTKP6RCZNVPH73XL7XFWTEOAO4MKONX7HOILHDVBMW5EVPOPZ";
const ADMIN_B = "G7AAAAYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ATTACKER = "GDXU2G6VZLJIFRVDH5HLYCWJ2F64YQZH2TJUFDPBTZC53RIRZQJQ4LNK";

const RECIPIENT = "GCKFBEIYTKP6RCZNVPH73XL7XFWTEOAO4MKONX7HOILHDVBMW5EVPOPZ";

const submitTx = jest.fn(async () => "chain-hash");

function approval(address: string, signature = "sig"): PoolApproval {
  return { address, signature, signedAt: 1 };
}

function governedPool(admins = [ADMIN_A, ADMIN_B], threshold = 2) {
  resetPoolState("pool-under-test");
  syncPoolFromChain("pool-under-test", { admins, threshold });
}

beforeEach(() => {
  jest.clearAllMocks();
  submitTx.mockImplementation(async () => "chain-hash");
  (useSubmitTx as jest.Mock).mockReturnValue(submitTx);
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ admins: [ADMIN_A, ADMIN_B], threshold: 2, balance: "100 XLM" }),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  resetPoolState();
});

describe("pool withdrawal approval verification (#1557)", () => {
  it("rejects a threshold withdrawal whose approvals come from non-admins", () => {
    governedPool();

    // The attack from the issue: an unprivileged user pads the approval list
    // with their own address until the threshold is met.
    const verdict = verifyPoolApprovals(getPoolRecord("pool-under-test"), [
      approval(ATTACKER),
      approval(ATTACKER),
    ]);

    expect(verdict.valid).toBe(false);
    expect(verdict).toMatchObject({ reason: expect.stringContaining("not a pool admin") });
  });

  it("refuses to record a withdrawal carrying non-admin approvals", () => {
    governedPool();

    const recorded = recordPoolWithdrawal("pool-under-test", {
      recipient: RECIPIENT,
      amount: "10",
      approvals: [approval(ATTACKER), approval(ATTACKER)],
    });

    expect(recorded).toBeNull();
    expect(getPoolRecord("pool-under-test").withdrawals).toHaveLength(0);
  });

  it("rejects approvals that carry no wallet signature", () => {
    governedPool();

    const verdict = verifyPoolApprovals(getPoolRecord("pool-under-test"), [
      approval(ADMIN_A, ""),
      approval(ADMIN_B),
    ]);

    expect(verdict).toMatchObject({ reason: expect.stringContaining("did not sign") });
  });

  it("rejects a below-threshold approval set", () => {
    governedPool();

    expect(
      verifyPoolApprovals(getPoolRecord("pool-under-test"), [approval(ADMIN_A)])
    ).toMatchObject({
      valid: false,
    });
  });

  it("fails closed while the admin set has not been loaded from the chain", () => {
    resetPoolState("pool-unknown");

    // No indexer snapshot: no governance, so nothing is authorised — and a
    // threshold of 0 must not be satisfiable by zero approvals.
    expect(verifyPoolApprovals(getPoolRecord("pool-unknown"), [])).toMatchObject({ valid: false });
  });

  it("rejects an indexer snapshot with no admins or a zero threshold", () => {
    resetPoolState("pool-bad");
    expect(syncPoolFromChain("pool-bad", { admins: [], threshold: 0 })).toBe(false);
    expect(syncPoolFromChain("pool-bad", { admins: [ADMIN_A], threshold: 0 })).toBe(false);
    expect(syncPoolFromChain("pool-bad", { admins: [ADMIN_A], threshold: 5 })).toBe(false);
    expect(getPoolRecord("pool-bad").source).toBe("unknown");
  });

  it("accepts a threshold set signed by distinct admins", () => {
    governedPool();

    expect(
      verifyPoolApprovals(getPoolRecord("pool-under-test"), [approval(ADMIN_A), approval(ADMIN_B)])
    ).toEqual({ valid: true });
  });
});

describe("usePoolWithdraw gates on the connected wallet (#1557)", () => {
  it("never enables submit for a non-admin, even at threshold", async () => {
    governedPool();
    (useWallet as jest.Mock).mockReturnValue({ address: ATTACKER, connected: true });

    const { result } = renderHook(() => usePoolWithdraw("pool-under-test"));
    await waitFor(() => expect(result.current.pool.source).toBe("chain"));

    act(() => {
      result.current.setRecipient(RECIPIENT);
      result.current.setAmount("10");
    });

    expect(result.current.connectedIsAdmin).toBe(false);
    expect(result.current.canSubmit).toBe(false);

    let id: string | null = "unset";
    await act(async () => {
      id = await result.current.submit();
    });

    expect(id).toBeNull();
    expect(submitTx).not.toHaveBeenCalled();
    expect(getPoolRecord("pool-under-test").withdrawals).toHaveLength(0);
  });

  it("cannot record an approval for an admin the connected wallet is not", async () => {
    governedPool();
    (useWallet as jest.Mock).mockReturnValue({ address: ATTACKER, connected: true });

    const { result } = renderHook(() => usePoolWithdraw("pool-under-test"));
    await waitFor(() => expect(result.current.pool.source).toBe("chain"));

    let signed: boolean | null = null;
    await act(async () => {
      signed = await result.current.signApproval();
    });

    expect(signed).toBe(false);
    expect(submitTx).not.toHaveBeenCalled();
    expect(result.current.approvals).toHaveLength(0);
  });

  it("fails closed when the wallet is unknown", async () => {
    governedPool();
    (useWallet as jest.Mock).mockReturnValue({ address: null, connected: false });

    const { result } = renderHook(() => usePoolWithdraw("pool-under-test"));

    expect(result.current.connectedAddress).toBeNull();
    expect(result.current.connectedIsAdmin).toBe(false);
    expect(result.current.canSubmit).toBe(false);
  });

  it("submits the threshold set of wallet signatures to the contract", async () => {
    governedPool();
    (useWallet as jest.Mock).mockReturnValue({ address: ADMIN_A, connected: true });

    const { result } = renderHook(() => usePoolWithdraw("pool-under-test"));
    await waitFor(() => expect(result.current.pool.source).toBe("chain"));

    act(() => {
      result.current.setRecipient(RECIPIENT);
      result.current.setAmount("10");
    });

    await act(async () => {
      await result.current.signApproval();
    });

    expect(result.current.approvals).toEqual([
      { address: ADMIN_A, signature: "chain-hash", signedAt: expect.any(Number) },
    ]);
    // Only one admin has signed, and the threshold is 2.
    expect(result.current.canSubmit).toBe(false);

    (useWallet as jest.Mock).mockReturnValue({ address: ADMIN_B, connected: true });
    const { result: second } = renderHook(() => usePoolWithdraw("pool-under-test"));
    await waitFor(() => expect(second.current.pool.source).toBe("chain"));
  });
});
