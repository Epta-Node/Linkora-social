"use client";

import { useState, useEffect } from "react";
import { LinkoraClient, generateDmKeypair } from "linkora-sdk";

interface DmKeySectionProps {
  address: string;
}

export function DmKeySection({ address }: DmKeySectionProps) {
  const [hasKey, setHasKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function checkDmKey() {
      try {
        const client = new LinkoraClient({
          contractId: process.env.NEXT_PUBLIC_CONTRACT_ID || "",
          rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-testnet.stellar.org",
        });
        const dmKey = await client.getDmKey(address);
        setHasKey(!!dmKey);
      } catch (error) {
        console.error("Failed to check DM key:", error);
      } finally {
        setLoading(false);
      }
    }
    checkDmKey();
  }, [address]);

  async function handlePublishKey() {
    setPublishing(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const { signTransaction } = await import("@stellar/freighter-api");
      const { rpc: rpcModule, Transaction } = await import("@stellar/stellar-sdk");

      // Generate new X25519 keypair
      const keypair = generateDmKeypair();

      const client = new LinkoraClient({
        contractId: process.env.NEXT_PUBLIC_CONTRACT_ID || "",
        rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-testnet.stellar.org",
      });

      // Build transaction XDR
      const txXdr = client.publishDmKey(address, keypair.publicKey);

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
        throw new Error(`DM Key transaction rejected: ${result.status}`);
      }

      await waitForConfirmation(server, result.hash);

      // Store private key securely (in a real app, this should be encrypted and stored securely)
      localStorage.setItem(
        `dm_private_key_${address}`,
        Buffer.from(keypair.privateKey).toString("base64")
      );

      setHasKey(true);
      setSuccessMessage("DM key published successfully! You can now receive encrypted messages.");
      setTimeout(() => setSuccessMessage(""), 5000);
    } catch (error) {
      console.error("Failed to publish DM key:", error);
      setErrorMessage("Failed to publish DM key. Please try again.");
    } finally {
      setPublishing(false);
    }
  }

  async function handleRotateKey() {
    if (!confirm("Rotating your DM key will invalidate all existing message threads. Continue?")) {
      return;
    }
    await handlePublishKey();
  }

  if (loading) {
    return (
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-xl font-semibold mb-4">Direct Messages</h2>
        <p className="text-gray-500">Loading DM key status...</p>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-xl font-semibold mb-4">Direct Messages</h2>
      <p className="text-sm text-gray-600 mb-4">
        Manage your X25519 public key for end-to-end encrypted direct messages.
      </p>

      {successMessage && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {errorMessage}
        </div>
      )}

      <div className="space-y-4">
        {hasKey ? (
          <>
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
              <svg
                className="w-5 h-5 text-green-600 mt-0.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-green-800">DM Key Active</p>
                <p className="text-xs text-green-700 mt-1">
                  Your public key is published. Others can send you encrypted messages.
                </p>
              </div>
            </div>
            <button
              onClick={handleRotateKey}
              disabled={publishing}
              className="px-4 py-2 bg-amber-100 text-amber-800 text-sm font-medium rounded-lg hover:bg-amber-200 border border-amber-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {publishing ? "Rotating Key..." : "Rotate Key"}
            </button>
          </>
        ) : (
          <>
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                You haven&apos;t published a DM key yet. Publish one to enable encrypted direct
                messages.
              </p>
            </div>
            <button
              onClick={handlePublishKey}
              disabled={publishing}
              className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {publishing ? "Publishing Key..." : "Publish DM Key"}
            </button>
          </>
        )}
      </div>
    </section>
  );
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
