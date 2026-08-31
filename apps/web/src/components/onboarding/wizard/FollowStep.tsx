"use client";

import React, { useState, useEffect } from "react";
import { useWallet } from "@/hooks/useWallet";

interface Creator {
  address: string;
  username: string;
  bio: string;
  followers: number;
}

// Curated list of suggested creators
const SUGGESTED_CREATORS: Creator[] = [
  {
    address: "GABC123",
    username: "stellar_dev",
    bio: "Building the future of decentralized social on Stellar",
    followers: 1250,
  },
  {
    address: "GDEF456",
    username: "crypto_artist",
    bio: "Digital artist creating NFT art on blockchain",
    followers: 890,
  },
  {
    address: "GHIJ789",
    username: "defi_educator",
    bio: "Teaching DeFi and blockchain fundamentals",
    followers: 2100,
  },
  {
    address: "GKLM012",
    username: "soroban_wizard",
    bio: "Smart contract development and tutorials",
    followers: 1500,
  },
  {
    address: "GNOP345",
    username: "stellar_news",
    bio: "Latest news and updates from the Stellar ecosystem",
    followers: 3200,
  },
  {
    address: "GQRS678",
    username: "web3_writer",
    bio: "Writing about Web3, crypto, and decentralization",
    followers: 750,
  },
];

interface FollowStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function FollowStep({ onNext, onBack, onSkip }: FollowStepProps) {
  const { address } = useWallet();
  const [selectedCreators, setSelectedCreators] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const toggleCreator = (creatorAddress: string) => {
    setSelectedCreators((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(creatorAddress)) {
        newSet.delete(creatorAddress);
      } else {
        newSet.add(creatorAddress);
      }
      return newSet;
    });
  };

  const handleContinue = async () => {
    setSubmitting(true);
    try {
      // TODO: Submit follow requests to contract
      const follows = Array.from(selectedCreators);
      console.log("Following creators:", follows);

      // Store locally for now
      localStorage.setItem("linkora_initial_follows", JSON.stringify(follows));

      onNext();
    } catch (error) {
      console.error("Failed to follow creators", error);
      alert("Failed to follow creators. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto py-8 px-6">
      <div className="mb-8 text-center">
        <div className="text-6xl mb-4">🤝</div>
        <h2 className="text-3xl font-bold mb-2">Follow Creators</h2>
        <p className="text-[var(--text-muted)]">
          Build your feed by following interesting creators
        </p>
        <p className="text-sm text-[var(--text-muted)] mt-2">
          Selected: <span className="font-semibold text-violet-500">{selectedCreators.size}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {SUGGESTED_CREATORS.map((creator) => {
          const isSelected = selectedCreators.has(creator.address);
          return (
            <button
              key={creator.address}
              onClick={() => toggleCreator(creator.address)}
              className={`p-4 rounded-lg border-2 transition-all text-left ${
                isSelected
                  ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30"
                  : "border-[var(--border)] bg-[var(--muted)] hover:border-violet-300"
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center text-white text-lg font-bold shadow-md">
                    {creator.username.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-semibold text-[var(--text)]">
                      @{creator.username}
                    </h3>
                    <p className="text-xs text-[var(--text-muted)]">
                      {creator.followers.toLocaleString()} followers
                    </p>
                  </div>
                </div>
                {/* Checkmark */}
                <div
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                    isSelected
                      ? "bg-violet-500 border-violet-500"
                      : "border-gray-300"
                  }`}
                >
                  {isSelected && (
                    <svg
                      className="w-4 h-4 text-white"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path d="M5 13l4 4L19 7"></path>
                    </svg>
                  )}
                </div>
              </div>
              <p className="text-sm text-[var(--text-muted)] line-clamp-2">
                {creator.bio}
              </p>
            </button>
          );
        })}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4 pt-6">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-3 border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleContinue}
          disabled={submitting}
          className="flex-1 px-6 py-3 bg-violet-600 text-white font-semibold rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
        >
          {submitting ? "Following..." : `Continue${selectedCreators.size > 0 ? ` (${selectedCreators.size} selected)` : ""}`}
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="px-6 py-3 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
