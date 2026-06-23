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
    try {
      const client = new LinkoraClient({
        contractId: process.env.NEXT_PUBLIC_CONTRACT_ID || "",
        rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-testnet.stellar.org",
      });

      // Build transaction XDR
      const txXdr = client.setProfile(address, values.username, values.creatorToken || address);

      // TODO: Sign and submit transaction using wallet
      console.log("Transaction XDR:", txXdr);

      setSuccessMessage("Profile updated successfully!");
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (error) {
      console.error("Failed to update profile:", error);
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
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          {successMessage}
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
