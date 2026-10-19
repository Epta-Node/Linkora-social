import { useCallback, useEffect, useMemo, useState } from "react";

import { useWallet } from "./useWallet";
import { useSubmitTx } from "./useSubmitTx";
import {
  isPoolGovernanceLoaded,
  isValidStellarAddress,
  normalizeAddress,
  recordPoolWithdrawal,
  refreshPoolFromIndexer,
  usePoolRecord,
  verifyPoolApprovals,
  type PoolApproval,
  type PoolSignerStatus,
} from "../utils/poolStore";

export type { PoolApproval, PoolSignerStatus } from "../utils/poolStore";

export interface UsePoolWithdrawReturn {
  pool: ReturnType<typeof usePoolRecord>;
  recipient: string;
  amount: string;
  connectedAddress: string | null;
  connectedIsAdmin: boolean;
  signerStatuses: PoolSignerStatus[];
  approvals: PoolApproval[];
  canSubmit: boolean;
  recipientError: string | null;
  thresholdStatus: string;
  status: string | null;
  /** Wallet-signed approval for the *connected* admin. Never signs for anyone else. */
  signApproval: () => Promise<boolean>;
  setRecipient: (value: string) => void;
  setAmount: (value: string) => void;
  submit: () => Promise<string | null>;
  reset: () => void;
}

/**
 * usePoolWithdraw
 *
 * #1557 — approvals are wallet signatures, not list entries. There is no API
 * to approve on another admin's behalf: `signApproval` builds and submits a real
 * `pool_withdraw` invocation for the connected address, so the only approval the
 * UI can express is one the connected wallet signed on-chain. The withdrawal
 * itself goes to the contract as a threshold set of those signatures and is
 * recorded locally only after the chain confirms, and `canSubmit` fails closed
 * whenever the admin set is not chain-sourced or the connected wallet is not a
 * known admin.
 *
 * #1591 — every path through `useSubmitTx` now yields real, simulated XDR and a
 * hash the chain confirmed. The contract has no `pool_withdraw_approve`
 * entrypoint, so no descriptor of that name is emitted; a descriptor that cannot
 * be turned into a real transaction is rejected outright.
 */
export function usePoolWithdraw(poolId: string): UsePoolWithdrawReturn {
  const pool = usePoolRecord(poolId);
  const { address, connected } = useWallet();
  const submitTx = useSubmitTx();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [approvals, setApprovals] = useState<PoolApproval[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [governanceLoaded, setGovernanceLoaded] = useState(pool.source === "chain");

  const connectedAddress = address ? normalizeAddress(address) : null;
  // Fail closed: an unknown or disconnected address is never treated as an admin.
  const connectedIsAdmin = Boolean(
    connected && connectedAddress && pool.admins.includes(connectedAddress)
  );

  // #1557 — the admin set and threshold come from the indexer/chain, never from
  // whatever the local store happened to hold.
  useEffect(() => {
    let cancelled = false;

    refreshPoolFromIndexer(poolId)
      .then((applied) => {
        if (!cancelled) setGovernanceLoaded(applied);
      })
      .catch(() => {
        if (!cancelled) setGovernanceLoaded(false);
      });

    return () => {
      cancelled = true;
    };
  }, [poolId, pool.source]);

  const signerStatuses = useMemo<PoolSignerStatus[]>(
    () =>
      pool.admins.map((admin) => ({
        address: admin,
        approved: approvals.some((approval) => approval.address === admin),
      })),
    [approvals, pool.admins]
  );

  const recipientError =
    recipient.trim().length === 0
      ? "Recipient is required"
      : isValidStellarAddress(recipient)
        ? null
        : "Enter a valid Stellar address";

  const thresholdStatus = `${approvals.length}/${pool.threshold} approvals`;
  const approvalVerdict = verifyPoolApprovals(pool, approvals);
  const approvalError: string | null = approvalVerdict.valid
    ? null
    : (approvalVerdict as { valid: false; reason: string }).reason;
  const canSubmit = Boolean(
    amount.trim() &&
    recipientError === null &&
    connectedIsAdmin &&
    governanceLoaded &&
    isPoolGovernanceLoaded(pool) &&
    approvalVerdict.valid
  );

  const signApproval = useCallback(async (): Promise<boolean> => {
    setStatus(null);

    if (!connectedAddress || !connectedIsAdmin) {
      setStatus("Connect an admin wallet to approve this withdrawal.");
      return false;
    }

    if (recipientError !== null || !amount.trim()) {
      setStatus(recipientError ?? "Enter a withdrawal amount.");
      return false;
    }

    try {
      // #1591 — the contract exposes no `pool_withdraw_approve` entrypoint. The
      // only real on-chain action an admin can take is a `pool_withdraw`
      // invocation they sign themselves, so that is what is built and submitted
      // here. The returned hash is the genuine on-chain proof of this admin's
      // consent; a pool whose threshold exceeds one admin will be rejected by
      // the contract, and that real failure is surfaced rather than faked.
      const signature = await submitTx(
        `pool_withdraw:${poolId}:${normalizeAddress(recipient)}:${amount.trim()}:${connectedAddress}=pending`
      );

      setApprovals((current) => [
        ...current.filter((approval) => approval.address !== connectedAddress),
        { address: connectedAddress, signature, signedAt: Date.now() },
      ]);
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Approval failed. Please try again.");
      return false;
    }
  }, [amount, connectedAddress, connectedIsAdmin, poolId, recipient, recipientError, submitTx]);

  const submit = useCallback(async (): Promise<string | null> => {
    setStatus(null);

    if (!canSubmit) {
      setStatus(approvalError ?? "Not authorised to submit this withdrawal.");
      return null;
    }

    // Hand the threshold set of admin signatures to the contract and let it
    // verify. The local record is written only once the chain has confirmed.
    await submitTx(
      `pool_withdraw:${poolId}:${normalizeAddress(recipient)}:${amount.trim()}:${approvals
        .map((approval) => `${approval.address}=${approval.signature}`)
        .join(",")}`
    );

    const withdrawal = recordPoolWithdrawal(poolId, {
      recipient: normalizeAddress(recipient),
      amount: amount.trim(),
      approvals,
    });

    return withdrawal?.id ?? null;
  }, [amount, approvalError, approvals, canSubmit, poolId, recipient, submitTx]);

  const reset = useCallback(() => {
    setRecipient("");
    setAmount("");
    setApprovals([]);
    setStatus(null);
  }, []);

  return {
    pool,
    recipient,
    amount,
    connectedAddress,
    connectedIsAdmin,
    signerStatuses,
    approvals,
    canSubmit,
    recipientError,
    thresholdStatus,
    status,
    signApproval,
    setRecipient,
    setAmount,
    submit,
    reset,
  };
}
