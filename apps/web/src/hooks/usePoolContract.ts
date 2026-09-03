"use client";

import { useState, useCallback } from "react";
import type { LinkoraClient, QueueSigner, RpcClient } from "linkora-sdk";
import { parseTokenAmount } from "./usePools";
import { config } from "@/config";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TxStatus =
  | "idle"
  | "approving" // increase_allowance step
  | "awaiting_sig" // waiting for Freighter signature
  | "submitting" // tx broadcast
  | "success"
  | "error";

export interface TxResult {
  hash: string;
  ledger?: number;
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

// ── Real contract calls via the shared sign + submit flow ─────────────────────
// These use the SDK's LinkoraClient to build transactions, sign them through the
// wallet, and submit / confirm them on chain through the TransactionQueue.

let poolClient: LinkoraClient | null = null;

async function getPoolClient(): Promise<LinkoraClient> {
  if (!poolClient) {
    const { LinkoraClient } = await import("linkora-sdk");
    poolClient = new LinkoraClient({
      contractId: config.contractId,
      rpcUrl: config.sorobanRpcUrl,
      networkPassphrase: config.networkPassphrase,
    });
  }
  return poolClient;
}

function makeFreighterSigner(networkPassphrase: string): QueueSigner {
  return {
    async signTransaction(xdr: string): Promise<string> {
      const { signTransaction } = await import("@stellar/freighter-api");
      return signTransaction(xdr, { networkPassphrase });
    },
  };
}

/**
 * Submit a prepared transaction through the SDK's TransactionQueue, forwarding
 * the queue's real `submitted` status so callers can reflect the actual
 * on-chain broadcast state. Resolves with the confirmed transaction hash.
 */
async function submitToNetwork(
  client: LinkoraClient,
  xdr: string,
  networkPassphrase: string,
  onBroadcast?: () => void
): Promise<string> {
  const { TransactionQueue } = await import("linkora-sdk");
  const queue = new TransactionQueue({
    signer: makeFreighterSigner(networkPassphrase),
    // The SDK's `createRpcServer` satisfies the queue's `RpcClient` contract at
    // runtime (the `submit.ts` shared flow relies on the same pairing).
    rpc: client.createRpcServer() as unknown as RpcClient,
  });

  queue.on("status", (event) => {
    if ((event.status === "submitted" || event.status === "pending") && onBroadcast) {
      onBroadcast();
    }
  });

  queue.enqueue(xdr);
  await queue.run();

  const hashes = queue.submittedHashes;
  if (hashes.length === 0) {
    throw new Error("Transaction was not submitted successfully.");
  }
  return hashes[0];
}

/**
 * SEP-41 `increase_allowance` pre-approval: authorize the pool contract to spend
 * the depositor's tokens during `pool_deposit`.
 */
async function callIncreaseAllowance(
  depositor: string,
  token: string,
  amount: bigint,
  spender: string
): Promise<void> {
  const client = await getPoolClient();
  const xdr = await client.prepareIncreaseAllowanceTx(depositor, token, spender, amount);
  await submitToNetwork(client, xdr, config.networkPassphrase);
}

async function callPoolDeposit(
  depositor: string,
  poolId: string,
  token: string,
  amount: bigint,
  onBroadcast?: () => void
): Promise<TxResult> {
  const client = await getPoolClient();
  const xdr = await client.preparePoolDepositTx(depositor, poolId, token, amount);
  const hash = await submitToNetwork(client, xdr, config.networkPassphrase, onBroadcast);
  return { hash };
}

async function callPoolWithdraw(
  signers: string[],
  poolId: string,
  amount: bigint,
  recipient: string,
  onBroadcast?: () => void
): Promise<TxResult> {
  const client = await getPoolClient();
  const xdr = await client.preparePoolWithdrawTx(signers, poolId, amount, recipient);
  const hash = await submitToNetwork(client, xdr, config.networkPassphrase, onBroadcast);
  return { hash };
}

async function callCreatePool(
  admin: string,
  poolId: string,
  token: string,
  initialAdmins: string[],
  threshold: number,
  onBroadcast?: () => void
): Promise<TxResult> {
  const client = await getPoolClient();
  const xdr = await client.prepareCreatePoolTx(admin, poolId, token, initialAdmins, threshold);
  const hash = await submitToNetwork(client, xdr, config.networkPassphrase, onBroadcast);
  return { hash };
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
        const tx = await callPoolDeposit(depositor, poolId, token, amount, () =>
          setStatus("submitting")
        );
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
        const tx = await callPoolWithdraw(signers, poolId, amount, recipient, () =>
          setStatus("submitting")
        );
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
        const tx = await callCreatePool(admin, poolId, token, initialAdmins, threshold, () =>
          setStatus("submitting")
        );
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
