"use client";

import React from "react";
import Link from "next/link";
import { useOnboarding } from "@/contexts/OnboardingContext";

interface EmptyFeedStateProps {
  variant?: "following" | "explore" | "no-results" | "search-error";
  onClearFilters?: () => void;
  onRetry?: () => void;
}

export function EmptyFeedState({
  variant = "explore",
  onClearFilters,
  onRetry,
}: EmptyFeedStateProps) {
  const { shouldShowOnboarding } = useOnboarding();
  const isFollowingEmpty = variant === "following";

  if (variant === "no-results" || variant === "search-error") {
    const failed = variant === "search-error";
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <svg
          aria-hidden="true"
          viewBox="0 0 240 160"
          className="mb-6 h-40 w-60 text-violet-500"
          fill="none"
        >
          <circle cx="112" cy="76" r="52" fill="currentColor" opacity=".1" />
          <circle cx="112" cy="76" r="34" stroke="currentColor" strokeWidth="8" opacity=".75" />
          <path d="m137 101 27 27" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
          <path
            d="M92 76h40M112 56v40"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
            opacity=".45"
          />
          <path
            d="M33 35h34M50 18v34M179 47h22M190 36v22"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            opacity=".35"
          />
        </svg>
        <h2 className="text-2xl font-bold mb-3">
          {failed ? "Search couldn't load" : "No posts found"}
        </h2>
        <p className="text-[var(--text-muted)] max-w-md mb-6">
          {failed
            ? "Check your connection and try the search again."
            : "Try a different search or clear your filters to explore all posts."}
        </p>
        {failed ? (
          <button
            type="button"
            onClick={onRetry}
            className="px-6 py-3 bg-violet-600 text-white font-semibold rounded-lg hover:bg-violet-700 transition-colors"
          >
            Retry
          </button>
        ) : (
          <button
            type="button"
            onClick={onClearFilters}
            className="px-6 py-3 bg-violet-600 text-white font-semibold rounded-lg hover:bg-violet-700 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>
    );
  }

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
