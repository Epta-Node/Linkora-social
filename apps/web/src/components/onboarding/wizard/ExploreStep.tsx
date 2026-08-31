"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface FeaturedPost {
  id: string;
  author: string;
  username: string;
  content: string;
  likes: number;
  tips: number;
}

// Mock featured posts
const FEATURED_POSTS: FeaturedPost[] = [
  {
    id: "1",
    author: "GABC123",
    username: "stellar_dev",
    content:
      "Just deployed my first Soroban smart contract! The developer experience is amazing. 🚀 #Stellar #Soroban",
    likes: 124,
    tips: 250,
  },
  {
    id: "2",
    author: "GDEF456",
    username: "crypto_artist",
    content:
      "New NFT collection dropping next week on Stellar! Preview available now. Check out my profile for details. 🎨",
    likes: 89,
    tips: 180,
  },
  {
    id: "3",
    author: "GHIJ789",
    username: "defi_educator",
    content:
      "Understanding liquidity pools: A beginner's guide. Thread 🧵👇\n\n1/ Liquidity pools are the backbone of DeFi...",
    likes: 256,
    tips: 420,
  },
];

interface ExploreStepProps {
  onComplete: () => void;
  onBack: () => void;
}

export function ExploreStep({ onComplete, onBack }: ExploreStepProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const handleFinish = async () => {
    setSubmitting(true);
    try {
      // Mark onboarding as complete
      await onComplete();

      // Small delay for UX
      setTimeout(() => {
        router.push("/feed");
      }, 500);
    } catch (error) {
      console.error("Failed to complete onboarding", error);
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto py-8 px-6">
      <div className="mb-8 text-center">
        <div className="text-6xl mb-4">🌟</div>
        <h2 className="text-3xl font-bold mb-2">Explore Featured Posts</h2>
        <p className="text-[var(--text-muted)]">See what&apos;s trending on Linkora</p>
      </div>

      {/* Featured Posts Preview */}
      <div className="space-y-4 mb-8">
        {FEATURED_POSTS.map((post) => (
          <div
            key={post.id}
            className="p-5 rounded-lg border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--muted)] transition-colors"
          >
            {/* Author */}
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center text-white text-sm font-bold shadow-md">
                {post.username.charAt(0).toUpperCase()}
              </div>
              <div>
                <h4 className="font-semibold text-[var(--text)]">@{post.username}</h4>
                <p className="text-xs text-[var(--text-muted)]">{post.author.slice(0, 8)}...</p>
              </div>
            </div>

            {/* Content */}
            <p className="text-[var(--text)] mb-3 whitespace-pre-line">{post.content}</p>

            {/* Engagement Stats */}
            <div className="flex items-center gap-4 text-sm text-[var(--text-muted)]">
              <div className="flex items-center gap-1">
                <span>❤️</span>
                <span>{post.likes}</span>
              </div>
              <div className="flex items-center gap-1">
                <span>💰</span>
                <span>{post.tips} XLM</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Completion Message */}
      <div className="p-6 rounded-lg bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/30 dark:to-purple-950/30 border border-violet-200 dark:border-violet-800 text-center mb-8">
        <div className="text-4xl mb-3">🎉</div>
        <h3 className="text-xl font-bold mb-2">You&apos;re All Set!</h3>
        <p className="text-[var(--text-muted)]">
          Your Linkora profile is ready. Start exploring, posting, and connecting with the
          community!
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-3 border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleFinish}
          disabled={submitting}
          className="flex-1 px-6 py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white font-semibold rounded-lg hover:from-violet-700 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
        >
          {submitting ? "Loading..." : "Start Using Linkora 🚀"}
        </button>
      </div>
    </div>
  );
}
