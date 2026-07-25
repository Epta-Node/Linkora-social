"use client";

import { useState, useEffect } from "react";
import { LinkoraClient } from "linkora-sdk";
import { validateStellarAddress } from "@/lib/validate";

interface BlockListSectionProps {
  address: string;
}

async function waitForConfirmation(
  server: any,
  hash: string,
  maxAttempts = 20,
  intervalMs = 3000
): Promise<void> {
  const interval = process.env.NODE_ENV === "test" ? 0 : intervalMs;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, interval));
    const tx = await server.getTransaction(hash);
    if (tx.status === "SUCCESS") return;
    if (tx.status === "FAILED") throw new Error(`Transaction ${hash} failed on-chain.`);
  }
  throw new Error(`Transaction ${hash} timed out waiting for confirmation.`);
}

const STORAGE_KEY = "linkora_blocked_accounts";

export function BlockListSection({ address }: BlockListSectionProps) {
  const [blockedList, setBlockedList] = useState<string[]>([]);
  const [newAddress, setNewAddress] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [blockingInProgress, setBlockingInProgress] = useState(false);
  const [unblockingAddress, setUnblockingAddress] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setBlockedList(JSON.parse(stored));
      } catch (err) {
        console.error("Failed to parse blocked accounts", err);
      }
    }
  }, []);

  function persistBlockedList(list: string[]) {
    setBlockedList(list);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  async function submitOnChain(
    method: "blockUser" | "unblockUser",
    targetAddress: string
  ): Promise<void> {
    const { signTransaction } = await import("@stellar/freighter-api");
    const { rpc: rpcModule, Transaction } = await import("@stellar/stellar-sdk");

    const client = new LinkoraClient({
      contractId: process.env.NEXT_PUBLIC_CONTRACT_ID || "",
      rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-testnet.stellar.org",
    });

    const txXdr =
      method === "blockUser"
        ? client.blockUser(address, targetAddress)
        : client.unblockUser(address, targetAddress);

    const signedXdr = await signTransaction(txXdr, {
      network: "TESTNET",
      accountToSign: address,
    });

    const networkPassphrase =
      process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
    const server = new rpcModule.Server(
      process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org"
    );

    const tx = new Transaction(signedXdr, networkPassphrase);
    const result = await server.sendTransaction(tx);

    if (result.status === "ERROR" || result.status === "DUPLICATE") {
      throw new Error(`Transaction rejected: ${result.status}`);
    }

    await waitForConfirmation(server, result.hash);
  }

  async function handleBlockAddress(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    const trimmed = newAddress.trim();
    if (!trimmed) {
      setError("Please enter a wallet address.");
      return;
    }

    const validation = validateStellarAddress(trimmed);
    if (!validation.valid) {
      setError(validation.error || "Invalid Stellar address.");
      return;
    }

    if (blockedList.includes(trimmed)) {
      setError("Address is already blocked.");
      return;
    }

    setBlockingInProgress(true);
    try {
      await submitOnChain("blockUser", trimmed);
      const updated = [...blockedList, trimmed];
      persistBlockedList(updated);
      setNewAddress("");
      setSuccess("Address blocked successfully.");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      console.error("Failed to block address:", err);
      setError("Failed to block address on-chain. Please try again.");
    } finally {
      setBlockingInProgress(false);
    }
  }

  async function handleUnblockAddress(addressToUnblock: string) {
    setError("");
    setSuccess("");
    setUnblockingAddress(addressToUnblock);
    try {
      await submitOnChain("unblockUser", addressToUnblock);
      const updated = blockedList.filter((addr) => addr !== addressToUnblock);
      persistBlockedList(updated);
      setSuccess("Address unblocked successfully.");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      console.error("Failed to unblock address:", err);
      setError("Failed to unblock address on-chain. Please try again.");
    } finally {
      setUnblockingAddress(null);
    }
  }

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-xl font-semibold mb-4">Block List</h2>
      <p className="text-sm text-gray-600 mb-4">
        Manage accounts you have blocked. Blocked accounts cannot follow you or view your posts.
      </p>

      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          {success}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleBlockAddress} className="flex gap-3 mb-6" aria-label="Block an account">
        <div className="flex-1">
          <label htmlFor="block-address-input" className="sr-only">
            Stellar Wallet Address to Block
          </label>
          <input
            id="block-address-input"
            type="text"
            value={newAddress}
            onChange={(e) => {
              setNewAddress(e.target.value);
              if (error) setError("");
            }}
            placeholder="Enter Stellar address (G...)"
            disabled={blockingInProgress}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={blockingInProgress}
          className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {blockingInProgress ? "Blocking..." : "Block Address"}
        </button>
      </form>

      {blockedList.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4 bg-gray-50 rounded-lg">
          No blocked accounts.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 border border-gray-150 rounded-lg max-h-60 overflow-y-auto">
          {blockedList.map((addr) => (
            <li key={addr} className="flex items-center justify-between p-3 gap-4">
              <span className="text-xs font-mono text-gray-700 break-all select-all">{addr}</span>
              <button
                type="button"
                onClick={() => handleUnblockAddress(addr)}
                disabled={unblockingAddress === addr}
                className="px-2.5 py-1 text-xs font-medium text-red-600 hover:text-red-700 border border-red-200 hover:border-red-300 rounded hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {unblockingAddress === addr ? "Unblocking..." : "Unblock"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
