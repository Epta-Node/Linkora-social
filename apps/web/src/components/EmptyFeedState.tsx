"use client";

import React from "react";
import Link from "next/link";
import { useOnboarding } from "@/contexts/OnboardingContext";

interface EmptyFeedStateProps {
  variant?: "following" | "explore";
}

export function EmptyFeedState({ variant = "explore" }: EmptyFeedStateProps) {
  const { shouldShowOnboarding } = useOnboarding();
  const isFollowingEmpty = variant === "following";

  if (isFollowingEmpty) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="text-8xl mb-6 opacity-50">👥</div>
        <h2 className="text-2xl font-bold mb-3">Your Feed is Empty</h2>
        <p className="text-[var(--text-muted)] max-w-md mb-8">
          You&apos;re not following anyone yet. Discover and follow creators to see their posts
          here.
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          <Link
            href="/explore"
            className="px-6 py-3 bg-violet-600 text-white font-semibold rounded-lg hover:bg-violet-700 transition-colors shadow-lg"
          >
            Explore Creators
          </Link>
          {shouldShowOnboarding() && (
            <Link
              href="/onboarding"
              className="px-6 py-3 border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors"
            >
              Complete Setup
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="text-8xl mb-6 opacity-50">🌟</div>
      <h2 className="text-2xl font-bold mb-3">Welcome to Linkora!</h2>
      <p className="text-[var(--text-muted)] max-w-md mb-8">
        Get started by creating your first post, following creators, or exploring what others are
        sharing.
      </p>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-3xl mb-8">
        <Link
          href="/post/new"
          className="p-6 bg-[var(--muted)] border border-[var(--border)] rounded-lg hover:border-violet-500 transition-all"
        >
          <div className="text-4xl mb-3">✍️</div>
          <h3 className="font-semibold mb-1">Create a Post</h3>
          <p className="text-sm text-[var(--text-muted)]">
            Share your first thought with the community
          </p>
        </Link>

        <Link
          href="/explore"
          className="p-6 bg-[var(--muted)] border border-[var(--border)] rounded-lg hover:border-violet-500 transition-all"
        >
          <div className="text-4xl mb-3">🔍</div>
          <h3 className="font-semibold mb-1">Explore</h3>
          <p className="text-sm text-[var(--text-muted)]">Discover trending posts and creators</p>
        </Link>

        <Link
          href="/profile/edit"
          className="p-6 bg-[var(--muted)] border border-[var(--border)] rounded-lg hover:border-violet-500 transition-all"
        >
          <div className="text-4xl mb-3">👤</div>
          <h3 className="font-semibold mb-1">Edit Profile</h3>
          <p className="text-sm text-[var(--text-muted)]">Customize your profile and bio</p>
        </Link>
      </div>

      {shouldShowOnboarding() && (
        <div className="p-4 bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-lg max-w-md">
          <p className="text-sm text-violet-900 dark:text-violet-200 mb-3">
            🎉 New here? Complete our onboarding wizard to get the most out of Linkora!
          </p>
          <Link
            href="/onboarding"
            className="inline-block px-6 py-2 bg-violet-600 text-white font-medium rounded-lg hover:bg-violet-700 transition-colors"
          >
            Start Onboarding
          </Link>
        </div>
      )}
    </div>
  );
}
