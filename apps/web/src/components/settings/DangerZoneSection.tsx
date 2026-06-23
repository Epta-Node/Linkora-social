"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LinkoraClient } from "linkora-sdk";

interface DangerZoneSectionProps {
  address: string;
}

export function DangerZoneSection({ address }: DangerZoneSectionProps) {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmAddress, setConfirmAddress] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleDeleteProfile() {
    if (confirmAddress !== address) {
      setError("Address does not match. Please type your address exactly.");
      return;
    }

    setDeleting(true);
    setError("");

    try {
      const client = new LinkoraClient({
        contractId: process.env.NEXT_PUBLIC_CONTRACT_ID || "",
        rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-testnet.stellar.org",
      });

      // Build delete transaction XDR
      const txXdr = client.deleteProfile(address);

      // TODO: Sign and submit transaction using wallet
      console.log("Delete Profile Transaction XDR:", txXdr);

      // Redirect to home after successful deletion
      router.push("/");
    } catch (err) {
      console.error("Failed to delete profile:", err);
      setError("Failed to delete profile. Please try again.");
      setDeleting(false);
    }
  }

  return (
    <section className="bg-red-50 rounded-lg border border-red-200 p-6">
      <h2 className="text-xl font-semibold mb-2 text-red-900">Danger Zone</h2>
      <p className="text-sm text-red-700 mb-4">Irreversible actions. Proceed with caution.</p>

      <div className="bg-white p-4 rounded-lg border border-red-300">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-gray-900">Delete Profile</h3>
            <p className="text-xs text-gray-600 mt-1">
              Permanently delete your profile, posts, and all associated data. This action cannot be
              undone.
            </p>
          </div>
          <button
            onClick={() => setShowConfirmDialog(true)}
            className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 whitespace-nowrap"
          >
            Delete Profile
          </button>
        </div>
      </div>

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-semibold mb-2 text-gray-900">Delete Profile?</h3>
            <p className="text-sm text-gray-600 mb-4">
              This will permanently delete your profile, posts, and all associated data. This action
              cannot be undone.
            </p>

            <div className="mb-4">
              <label htmlFor="confirm-address" className="block text-sm font-medium mb-2">
                Type your wallet address to confirm:
              </label>
              <input
                id="confirm-address"
                type="text"
                value={confirmAddress}
                onChange={(e) => {
                  setConfirmAddress(e.target.value);
                  setError("");
                }}
                placeholder={address}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-500"
                disabled={deleting}
              />
              <p className="text-xs text-gray-500 mt-1">Must match exactly: {address}</p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowConfirmDialog(false);
                  setConfirmAddress("");
                  setError("");
                }}
                disabled={deleting}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteProfile}
                disabled={deleting || confirmAddress !== address}
                className="flex-1 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? "Deleting..." : "Delete Profile"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
