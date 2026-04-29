"use client";

import { useState, useCallback } from "react";
import { parseTokenAmount } from "./usePools";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TxStatus =
  | "idle"
  | "approving"       // increase_allowance step
  | "awaiting_sig"    // waiting for Freighter signature
  | "submitting"      // tx broadcast
  | "success"
  | "error";

export interface TxResult {
  hash: string;
  ledger: number;
}

// ── Error classifier ──────────────────────────────────────────────────────────

export function classifyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/allowance|insufficient allowance/i.test(msg)) return "Insufficient Allowance";
  if (/balance|low balance/i.test(msg)) return "Insufficient Balance";
  if (/unauthorized|not admin/i.test(msg)) return "Unauthorized — you are not a pool admin";
  if (/pool not found/i.test(msg)) return "Pool not found";
  if (/wrong token/i.test(msg)) return "Token mismatch — wrong token for this pool";
  if (/threshold|insufficient signers/i.test(msg))
    return "Not enough admin signatures to execute withdrawal";
  if (/user rejected|denied/i.test(msg)) return "Transaction rejected by wallet";
  return msg || "Transaction failed";
}

// ── Mock contract calls ───────────────────────────────────────────────────────
// Replace with real SDK calls once the generated client is available.

async function callIncreaseAllowance(
  _depositor: string,
  _token: string,
  _amount: bigint,
  _spender: string
): Promise<void> {
  // TODO: token::Client.increase_allowance(depositor, spender, amount)
  await new Promise((r) => setTimeout(r, 900));
}

async function callPoolDeposit(
  _depositor: string,
  _poolId: string,
  _token: string,
  _amount: bigint
): Promise<TxResult> {
  // TODO: client.pool_deposit({ depositor, pool_id, token, amount })
  await new Promise((r) => setTimeout(r, 1200));
  return { hash: "abc123def456", ledger: 12345678 };
}

async function callPoolWithdraw(
  _signers: string[],
  _poolId: string,
  _amount: bigint,
  _recipient: string
): Promise<TxResult> {
  // TODO: client.pool_withdraw({ signers, pool_id, amount, recipient })
  await new Promise((r) => setTimeout(r, 1200));
  return { hash: "xyz789uvw012", ledger: 12345679 };
}

async function callCreatePool(
  _admin: string,
  _poolId: string,
  _token: string,
  _initialAdmins: string[],
  _threshold: number
): Promise<TxResult> {
  // TODO: client.create_pool({ admin, pool_id, token, initial_admins, threshold })
  await new Promise((r) => setTimeout(r, 1400));
  return { hash: "pool_create_hash", ledger: 12345680 };
}

// ── useDeposit ────────────────────────────────────────────────────────────────

export function useDeposit() {
  const [status, setStatus] = useState<TxStatus>("idle");
  const [result, setResult] = useState<TxResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deposit = useCallback(
    async (
      depositor: string,
      poolId: string,
      token: string,
      amountRaw: string,
      decimals: number,
      contractAddress: string
    ) => {
      setStatus("approving");
      setError(null);
      setResult(null);

      try {
        const amount = parseTokenAmount(amountRaw, decimals);

        // Step 1: increase_allowance for the SEP-41 token
        await callIncreaseAllowance(depositor, token, amount, contractAddress);

        // Step 2: pool_deposit
        setStatus("awaiting_sig");
        await new Promise((r) => setTimeout(r, 300)); // brief pause for UX
        setStatus("submitting");

        const tx = await callPoolDeposit(depositor, poolId, token, amount);
        setResult(tx);
        setStatus("success");
      } catch (err) {
        setError(classifyError(err));
        setStatus("error");
      }
    },
    []
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  return { status, result, error, deposit, reset };
}

// ── useWithdraw ───────────────────────────────────────────────────────────────

export function useWithdraw() {
  const [status, setStatus] = useState<TxStatus>("idle");
  const [result, setResult] = useState<TxResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const withdraw = useCallback(
    async (
      signers: string[],
      poolId: string,
      amountRaw: string,
      decimals: number,
      recipient: string
    ) => {
      setStatus("awaiting_sig");
      setError(null);
      setResult(null);

      try {
        const amount = parseTokenAmount(amountRaw, decimals);

        setStatus("submitting");
        const tx = await callPoolWithdraw(signers, poolId, amount, recipient);
        setResult(tx);
        setStatus("success");
      } catch (err) {
        setError(classifyError(err));
        setStatus("error");
      }
    },
    []
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  return { status, result, error, withdraw, reset };
}

// ── useCreatePool ─────────────────────────────────────────────────────────────

export function useCreatePool() {
  const [status, setStatus] = useState<TxStatus>("idle");
  const [result, setResult] = useState<TxResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createPool = useCallback(
    async (
      admin: string,
      poolId: string,
      token: string,
      initialAdmins: string[],
      threshold: number
    ) => {
      setStatus("awaiting_sig");
      setError(null);
      setResult(null);

      try {
        setStatus("submitting");
        const tx = await callCreatePool(admin, poolId, token, initialAdmins, threshold);
        setResult(tx);
        setStatus("success");
      } catch (err) {
        setError(classifyError(err));
        setStatus("error");
      }
    },
    []
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  return { status, result, error, createPool, reset };
}
