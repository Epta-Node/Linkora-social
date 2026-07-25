"use client";

import React from "react";

interface WelcomeStepProps {
  onNext: () => void;
  onSkip: () => void;
}

export function WelcomeStep({ onNext, onSkip }: WelcomeStepProps) {
  return (
    <div className="flex flex-col items-center text-center space-y-6 py-8 px-6">
      {/* Hero Icon */}
      <div className="text-8xl mb-4 animate-bounce">🚀</div>

      {/* Welcome Message */}
      <div className="space-y-4">
        <h1 className="text-4xl font-extrabold tracking-tight">
          Welcome to <span className="text-violet-500">Linkora</span>
        </h1>
        <p className="text-lg text-[var(--text-muted)] max-w-lg mx-auto">
          Your decentralized social network on Stellar. Let&apos;s get you set up in just a few
          steps!
        </p>
      </div>

      {/* Features Preview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-3xl mt-8">
        <div className="bg-[var(--muted)] p-4 rounded-lg border border-[var(--border)]">
          <div className="text-3xl mb-2">👤</div>
          <h3 className="font-semibold mb-1">Create Your Profile</h3>
          <p className="text-sm text-[var(--text-muted)]">Set up your identity and stand out</p>
        </div>
        <div className="bg-[var(--muted)] p-4 rounded-lg border border-[var(--border)]">
          <div className="text-3xl mb-2">🤝</div>
          <h3 className="font-semibold mb-1">Connect with Creators</h3>
          <p className="text-sm text-[var(--text-muted)]">
            Follow amazing people and build your network
          </p>
        </div>
        <div className="bg-[var(--muted)] p-4 rounded-lg border border-[var(--border)]">
          <div className="text-3xl mb-2">💰</div>
          <h3 className="font-semibold mb-1">Earn & Tip</h3>
          <p className="text-sm text-[var(--text-muted)]">
            Support creators and earn from your content
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4 mt-8 w-full max-w-md">
        <button
          onClick={onNext}
          className="flex-1 px-6 py-3 bg-violet-600 text-white font-semibold rounded-lg hover:bg-violet-700 transition-colors shadow-lg"
        >
          Let&apos;s Get Started
        </button>
        <button
          onClick={onSkip}
          className="px-6 py-3 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
