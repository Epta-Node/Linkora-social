'use client';

/**
 * Contract helpers for DM key management in apps/web.
 *
 * Uses LinkoraClient from linkora-sdk (via webpack alias → SDK TypeScript
 * source) so apps/web does not need @stellar/stellar-sdk as a direct dep.
 *
 * getDmKey      – read-only simulation, no signing required.
 * publishDmKey  – builds the transaction via SDK, signs via Freighter, submits
 *                 to the Soroban RPC using a raw JSON-RPC fetch.
 */

import { LinkoraClient } from 'linkora-sdk';

// ── Config ────────────────────────────────────────────────────────────────────

const RPC_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SOROBAN_RPC_URL) ||
  'https://soroban-testnet.stellar.org';

const CONTRACT_ID =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_CONTRACT_ID) || '';

const NETWORK_PASSPHRASE =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE) ||
  'Test SDF Network ; September 2015';

// ── Singleton client ──────────────────────────────────────────────────────────

let _client: LinkoraClient | null = null;

function getClient(): LinkoraClient {
  if (!_client) {
    _client = new LinkoraClient({
      contractId: CONTRACT_ID,
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
    });
  }
  return _client;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch the X25519 public key published by `address` to the Linkora contract.
 * Returns null if the user has never called publishDmKey or the contract is
 * not configured.
 */
export async function getDmKey(address: string): Promise<Uint8Array | null> {
  if (!CONTRACT_ID) return null;
  return getClient().getDmKey(address);
}

/**
 * Publish the caller's X25519 public key to the Linkora contract.
 *
 * Flow:
 *   1. SDK builds + simulates the transaction (proper source account + fees).
 *   2. Freighter signs the XDR.
 *   3. Signed XDR is submitted to the Soroban RPC via raw JSON-RPC.
 */
export async function publishDmKey(
  userAddress: string,
  x25519PubKey: Uint8Array,
): Promise<void> {
  if (!CONTRACT_ID) throw new Error('NEXT_PUBLIC_CONTRACT_ID is not configured');

  // Step 1 — build a properly-sourced XDR ready for Freighter signing
  const unsignedXdr = await getClient().prepareDmKeyTx(userAddress, x25519PubKey);

  // Step 2 — sign via Freighter
  const { signTransaction } = await import('@stellar/freighter-api');
  const signedXdr = await signTransaction(unsignedXdr, {
    networkPassphrase: NETWORK_PASSPHRASE,
    accountToSign: userAddress,
  });

  // Step 3 — submit to Soroban RPC directly (no stellar-sdk needed here)
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: { transaction: signedXdr },
    }),
  });

  if (!res.ok) {
    throw new Error(`RPC request failed (HTTP ${res.status}): ${res.statusText}`);
  }

  const data: { result?: { status: string }; error?: { message: string } } =
    await res.json();

  if (data.error) {
    throw new Error(`Transaction rejected: ${data.error.message}`);
  }

  const status = data.result?.status;
  if (status && status !== 'PENDING' && status !== 'SUCCESS') {
    throw new Error(`Unexpected transaction status: ${status}`);
  }
}
