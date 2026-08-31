"use client";

import { useState, useEffect } from "react";
import { ProfileForm, ProfileFormValues } from "@/components/forms/ProfileForm";
import { LinkoraClient } from "linkora-sdk";

interface ProfileSectionProps {
  address: string;
}

export function ProfileSection({ address }: ProfileSectionProps) {
  const [initialValues, setInitialValues] = useState<Partial<ProfileFormValues>>({});
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function loadProfile() {
      try {
        const client = new LinkoraClient({
          contractId: process.env.NEXT_PUBLIC_CONTRACT_ID || "",
          rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-testnet.stellar.org",
        });
        const profile = await client.getProfile(address);
        if (profile) {
          setInitialValues({
            username: profile.username,
            creatorToken: profile.creator_token,
          });
        }
      } catch (error) {
        console.error("Failed to load profile:", error);
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, [address]);

  async function handleSubmit(values: ProfileFormValues) {
    setErrorMessage("");
    try {
      const { signTransaction } = await import("@stellar/freighter-api");
      const { rpc: rpcModule, Transaction } = await import("@stellar/stellar-sdk");

      const client = new LinkoraClient({
        contractId: process.env.NEXT_PUBLIC_CONTRACT_ID || "",
        rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-testnet.stellar.org",
      });

      // Build transaction XDR
      const txXdr = client.setProfile(address, values.username, values.creatorToken || address);

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
        throw new Error(`Profile registration rejected: ${result.status}`);
      }

      await waitForConfirmation(server, result.hash);

      setSuccessMessage("Profile updated successfully!");
      setInitialValues({
        username: values.username,
        creatorToken: values.creatorToken || address,
      });
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (error) {
      console.error("Failed to update profile:", error);
      setErrorMessage("Failed to update profile. Please try again.");
    }
  }

  if (loading) {
    return (
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-xl font-semibold mb-4">Profile</h2>
        <p className="text-gray-500">Loading profile...</p>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-xl font-semibold mb-4">Profile</h2>
      <p className="text-sm text-gray-600 mb-4">Update your username and creator token settings.</p>

      {successMessage && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm" role="status">
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm" role="alert">
          {errorMessage}
        </div>
      )}

      <ProfileForm onSubmit={handleSubmit} initialValues={initialValues} />

      {initialValues.creatorToken && (
        <div className="mt-4 p-3 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-500 mb-1">Creator Token Address (read-only)</p>
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono text-gray-700 break-all">
              {initialValues.creatorToken}
            </code>
            <a
              href={`/creator/wizard?token=${initialValues.creatorToken}`}
              className="text-xs text-violet-600 hover:text-violet-700 whitespace-nowrap"
            >
              Manage →
            </a>
          </div>
        </div>
      )}
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
