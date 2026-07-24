/**
 * Shared test setup and utilities for E2E integration tests.
 *
 * Provides:
 * - Funded test accounts (Alice, Bob, Charlie) created via Stellar friendbot
 * - Transaction signing and submission to the local Stellar RPC
 * - Polling utilities for eventually-consistent indexer operations
 * - Environment-aware configuration (local sandbox vs testnet)
 */

import {
  Keypair,
  rpc,
  TransactionBuilder,
  Account,
  Contract,
  nativeToScVal,
  scValToNative,
  xdr,
  Networks,
  StrKey,
} from "@stellar/stellar-sdk";
import { LinkoraClient } from "linkora-sdk";

// ── Environment Configuration ──────────────────────────────────────────────

export interface TestEnvironment {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  tokenId: string;
  indexerUrl: string;
  dmRelayUrl: string;
  horizonUrl: string;
}

function getEnvConfig(): TestEnvironment {
  const isTestnet =
    process.env.STELLAR_NETWORK === "testnet" ||
    process.env.STELLAR_NETWORK === "TESTNET";

  return {
    rpcUrl:
      process.env.STELLAR_RPC_URL ||
      (isTestnet
        ? "https://soroban-testnet.stellar.org"
        : "http://localhost:8000/rpc"),
    networkPassphrase:
      process.env.STELLAR_NETWORK_PASSPHRASE ||
      (isTestnet
        ? Networks.TESTNET
        : "Standalone Network ; February 2017"),
    contractId: process.env.CONTRACT_ID || "",
    tokenId: process.env.TOKEN_ID || "",
    indexerUrl: process.env.INDEXER_URL || "http://localhost:3002",
    dmRelayUrl: process.env.DM_RELAY_URL || "http://localhost:3003",
    horizonUrl:
      process.env.HORIZON_URL ||
      (isTestnet
        ? "https://horizon-testnet.stellar.org"
        : "http://localhost:8000"),
  };
}

// ── Test Keypairs ──────────────────────────────────────────────────────────

export interface TestKeypair {
  keypair: Keypair;
  address: string;
}

/**
 * Create a test keypair from a given secret key (from env) or generate a new one
 * and fund it via friendbot.
 */
export async function createTestKeypair(
  secretKey?: string
): Promise<TestKeypair> {
  const keypair = secretKey
    ? Keypair.fromSecret(secretKey)
    : Keypair.random();
  const address = keypair.publicKey();

  if (!secretKey) {
    // Fund via friendbot
    const env = getEnvConfig();
    const friendbotUrl =
      env.horizonUrl.replace(/\/$/, "") + "/friendbot";
    const response = await fetch(`${friendbotUrl}?addr=${address}`, {
      method: "POST",
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Friendbot funding failed for ${address}: HTTP ${response.status} - ${body}`
      );
    }
  }

  return { keypair, address };
}

// ── Transaction Submission ─────────────────────────────────────────────────

/**
 * Submit a Soroban contract invocation transaction.
 *
 * Builds, simulates, signs, and submits the transaction using the Stellar RPC.
 * Uses the SDK's prepareTransaction-like approach:
 * 1. Simulate with a placeholder account to get resource fees and footprint
 * 2. Build the real transaction with the signer's account
 * 3. Apply the simulated soroban data
 * 4. Sign and submit
 * 5. Poll for completion
 */
export async function submitContractCall(
  method: string,
  args: xdr.ScVal[],
  signer: Keypair,
  contractId?: string
): Promise<string> {
  const env = getEnvConfig();
  const server = new rpc.Server(env.rpcUrl);
  const contract = new Contract(contractId || env.contractId);

  // Step 1: Build a preliminary tx with a random source to simulate
  const tempSource = Keypair.random();
  const tempAccount = new Account(tempSource.publicKey(), "0");
  const simTx = new TransactionBuilder(tempAccount, {
    fee: "100",
    networkPassphrase: env.networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();

  // Step 2: Simulate to get resource fees and soroban data
  const simResult = await server.simulateTransaction(simTx);

  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(
      `Simulation failed for ${method}: ${simResult.error}. ` +
        `Args: ${JSON.stringify(args.map((a) => a.value()))}`
    );
  }

  if (!rpc.Api.isSimulationSuccess(simResult) || !simResult.result) {
    throw new Error(
      `Simulation returned unexpected result for ${method}: ` +
        `${JSON.stringify(simResult)}`
    );
  }

  // Step 3: Get the real account for sequence number
  const sourceAccount = await server.getAccount(signer.publicKey());
  const minFee = simResult.minResourceFee
    ? String(Number(simResult.minResourceFee) + 100)
    : "10000";
  const sorobanData = simResult.transactionData;

  // Step 4: Build the real transaction with proper fee and soroban data
  const preparedTx = new TransactionBuilder(sourceAccount, {
    fee: minFee,
    networkPassphrase: env.networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60);

  // Apply soroban data if available (setSorobanData exists on builder internals)
  if (sorobanData) {
    // The TransactionBuilder has setSorobanData in newer stellar-sdk versions
    // through the SorobanTransactionBuilder extension
    (preparedTx as unknown as { setSorobanData: (d: typeof sorobanData) => void }).setSorobanData(
      sorobanData
    );
  }

  const finalTx = preparedTx.build();
  finalTx.sign(signer);

  // Step 5: Submit
  const sendResult = await server.sendTransaction(finalTx);

  if (sendResult.status === "PENDING" || sendResult.status === "DUPLICATE") {
    const hash = sendResult.hash;
    const maxRetries = 30;
    for (let i = 0; i < maxRetries; i++) {
      await sleep(1000);
      const getResult = await server.getTransaction(hash);
      if (getResult.status === "SUCCESS") {
        return hash;
      }
      if (getResult.status === "FAILED") {
        throw new Error(
          `Transaction ${method} failed: ${JSON.stringify(getResult)}`
        );
      }
      // Still PENDING or NOT_FOUND, keep polling
    }
    throw new Error(
      `Transaction ${method} timed out after ${maxRetries}s: hash=${hash}`
    );
  }

  throw new Error(
    `Transaction submission failed for ${method}: ` +
      `${JSON.stringify(sendResult)}`
  );
}

// ── Indexer Polling ─────────────────────────────────────────────────────────

/**
 * Poll the indexer API until a condition is met or timeout.
 * Used for eventually-consistent indexer operations.
 */
export async function waitForIndexer(
  check: () => Promise<boolean> | boolean,
  timeoutMs = 30_000,
  intervalMs = 1_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return;
    await sleep(intervalMs);
  }
  throw new Error(
    `Indexer condition not met within ${timeoutMs}ms timeout`
  );
}

/**
 * Convenience: Wait for a profile to appear in the indexer API.
 */
export async function waitForIndexedProfile(
  address: string
): Promise<Record<string, unknown>> {
  const env = getEnvConfig();
  let profile: Record<string, unknown> | null = null;

  await waitForIndexer(async () => {
    const res = await fetch(
      `${env.indexerUrl}/api/profiles/${address}`
    );
    if (res.ok) {
      profile = (await res.json()) as Record<string, unknown>;
      return true;
    }
    return false;
  }, 45_000);

  return profile!;
}

/**
 * Convenience: Wait for a post to appear in the indexer API.
 */
export async function waitForIndexedPost(
  postId: string | bigint
): Promise<Record<string, unknown>> {
  const env = getEnvConfig();
  let post: Record<string, unknown> | null = null;

  await waitForIndexer(async () => {
    const res = await fetch(
      `${env.indexerUrl}/api/posts/${postId.toString()}`
    );
    if (res.ok) {
      post = (await res.json()) as Record<string, unknown>;
      return true;
    }
    return false;
  }, 45_000);

  return post!;
}

/**
 * Convenience: Wait for governance proposal to appear.
 */
export async function waitForIndexedProposal(
  proposalId: string | bigint
): Promise<Record<string, unknown>> {
  const env = getEnvConfig();

  await waitForIndexer(async () => {
    const res = await fetch(
      `${env.indexerUrl}/api/governance/proposals`
    );
    if (res.ok) {
      const data = (await res.json()) as {
        proposals: Array<Record<string, unknown>>;
      };
      return data.proposals.some(
        (p) => p.proposal_id === proposalId.toString()
      );
    }
    return false;
  }, 45_000);

  // Return the proposal now that we know it exists
  const res = await fetch(
    `${env.indexerUrl}/api/governance/proposals`
  );
  const data = (await res.json()) as {
    proposals: Array<Record<string, unknown>>;
  };
  return data.proposals.find(
    (p) => p.proposal_id === proposalId.toString()
  )!;
}

// ── SDK Client Factory ─────────────────────────────────────────────────────

/**
 * Create a LinkoraClient configured for the test environment.
 * Used for read operations (simulate calls).
 */
export function createClient(): LinkoraClient {
  const env = getEnvConfig();
  return new LinkoraClient({
    contractId: env.contractId,
    rpcUrl: env.rpcUrl,
    networkPassphrase: env.networkPassphrase,
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function scvAddress(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: "address" });
}

export function scvString(value: string): xdr.ScVal {
  return nativeToScVal(value);
}

export function scvU64(value: number | bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "u64" });
}

export function scvI128(value: number | bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "i128" });
}

export function scvU32(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: "u32" });
}

export function scvSymbol(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: "symbol" });
}

export function scvBool(value: boolean): xdr.ScVal {
  return nativeToScVal(value);
}

export function scvBytes(value: Uint8Array): xdr.ScVal {
  return nativeToScVal(value, { type: "bytes" });
}

/**
 * Get the environment config (cached per call, not per module to avoid
 * cross-module caching issues in Jest).
 */
export function getEnv(): TestEnvironment {
  return getEnvConfig();
}

/**
 * Check that all required env vars are set.
 * Call at the start of each test suite.
 */
export function requireEnv(): TestEnvironment {
  const env = getEnv();
  if (!env.contractId) {
    throw new Error(
      "CONTRACT_ID environment variable is required. " +
        "Run tests via run_e2e.sh which sets up the environment."
    );
  }
  if (!env.tokenId) {
    throw new Error(
      "TOKEN_ID environment variable is required. " +
        "Run tests via run_e2e.sh which sets up the environment."
    );
  }
  return env;
}

// ── Retry decorator ────────────────────────────────────────────────────────

/**
 * Retry an async operation with exponential backoff.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 200 } = options;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn(
        `[retry] Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delay}ms: ${error}`
      );
      await sleep(delay);
    }
  }
  throw new Error("Unreachable");
}
