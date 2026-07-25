"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useOnboarding } from "@/contexts/OnboardingContext";
import { useGuidedTour } from "@/hooks/useGuidedTour";

export function OnboardingSettings() {
  const router = useRouter();
  const { state, resetOnboarding } = useOnboarding();
  const guidedTourContext = useGuidedTour();

  const handleRestartFeatureTour = () => {
    guidedTourContext?.resetTour();
    router.push("/feed");
  };

  const handleRestartOnboarding = () => {
    if (
      confirm(
        "Are you sure you want to restart the onboarding wizard? This will reset your onboarding progress."
      )
    ) {
      resetOnboarding();
      router.push("/onboarding");
    }
  };

  return (
    <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-6">
      <h2 className="text-xl font-bold mb-4">Onboarding</h2>

      <div className="space-y-4">
        {/* Status */}
        <div className="flex items-center justify-between p-4 bg-[var(--muted)] rounded-lg">
          <div>
            <h3 className="font-medium">Onboarding Status</h3>
            <p className="text-sm text-[var(--text-muted)]">
              {state.isComplete || state.skipped
                ? "Completed"
                : `In progress (Step ${state.currentStep + 1}/5)`}
            </p>
          </div>
          <div>
            {state.isComplete || state.skipped ? (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                ✓ Complete
              </span>
            ) : (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
                ⏱ In Progress
              </span>
            )}
          </div>
        </div>

        {/* Completed Steps */}
        <div className="space-y-2">
          <h3 className="font-medium text-sm text-[var(--text-muted)]">Completed Steps:</h3>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(state.completedSteps).map(([key, completed]) => (
              <div
                key={key}
                className={`flex items-center gap-2 p-2 rounded border ${
                  completed
                    ? "border-green-500 bg-green-50 dark:bg-green-950/30"
                    : "border-[var(--border)] bg-[var(--muted)]"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center ${
                    completed ? "bg-green-500 text-white" : "bg-gray-300"
                  }`}
                >
                  {completed && "✓"}
                </div>
                <span className="text-sm capitalize">{key}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="pt-4 space-y-3">
          {!state.isComplete && !state.skipped && (
            <button
              onClick={() => router.push("/onboarding")}
              className="w-full px-4 py-2 bg-violet-600 text-white font-medium rounded-lg hover:bg-violet-700 transition-colors"
            >
              Continue Onboarding
            </button>
          )}

          <button
            onClick={handleRestartFeatureTour}
            className="w-full px-4 py-2 border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors"
          >
            Replay Feature Tour
          </button>

          <button
            onClick={handleRestartOnboarding}
            className="w-full px-4 py-2 border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors"
          >
            Restart Onboarding Wizard
          </button>
        </div>

        {/* Info */}
        <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-sm text-blue-900 dark:text-blue-200">
            💡 The onboarding wizard helps you set up your profile, follow creators, and configure
            notifications. You can revisit it anytime from settings.
          </p>
        </div>
      </div>
    </div>
  );
}
