"use client";

import React from "react";
import { useOnboarding } from "@/contexts/OnboardingContext";
import { WelcomeStep } from "./WelcomeStep";
import { ProfileStep } from "./ProfileStep";
import { FollowStep } from "./FollowStep";
import { NotificationStep } from "./NotificationStep";
import { ExploreStep } from "./ExploreStep";

const STEPS = [
  { id: "welcome", label: "Welcome", component: WelcomeStep },
  { id: "profile", label: "Profile", component: ProfileStep },
  { id: "follow", label: "Follow", component: FollowStep },
  { id: "notifications", label: "Notifications", component: NotificationStep },
  { id: "explore", label: "Explore", component: ExploreStep },
] as const;

export function OnboardingWizard() {
  const { state, setStep, completeStep, skipOnboarding } = useOnboarding();

  const handleNext = () => {
    const currentStepKey = STEPS[state.currentStep].id;
    completeStep(currentStepKey as keyof typeof state.completedSteps);
    setStep(state.currentStep + 1);
  };

  const handleBack = () => {
    setStep(Math.max(0, state.currentStep - 1));
  };

  const handleSkip = () => {
    skipOnboarding();
  };

  const handleComplete = () => {
    completeStep("explore");
    skipOnboarding();
  };

  const CurrentStepComponent = STEPS[state.currentStep]?.component;

  if (!CurrentStepComponent) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[var(--background)] flex flex-col">
      {/* Progress Bar */}
      <div className="w-full bg-[var(--muted)] border-b border-[var(--border)]">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-[var(--text-muted)]">
              Step {state.currentStep + 1} of {STEPS.length}
            </h3>
            <button
              onClick={handleSkip}
              className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              Skip setup →
            </button>
          </div>
          <div className="flex gap-2">
            {STEPS.map((step, index) => (
              <div
                key={step.id}
                className="flex-1 h-2 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700"
              >
                <div
                  className={`h-full transition-all duration-300 ${
                    index <= state.currentStep
                      ? "bg-gradient-to-r from-violet-500 to-purple-500"
                      : "bg-gray-200 dark:bg-gray-700"
                  }`}
                  style={{
                    width:
                      index < state.currentStep
                        ? "100%"
                        : index === state.currentStep
                          ? "50%"
                          : "0%",
                  }}
                />
              </div>
            ))}
          </div>
          {/* Step Labels */}
          <div className="flex justify-between mt-2">
            {STEPS.map((step, index) => (
              <span
                key={step.id}
                className={`text-xs ${
                  index <= state.currentStep
                    ? "text-violet-600 dark:text-violet-400 font-medium"
                    : "text-[var(--text-muted)]"
                }`}
              >
                {step.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Step Content */}
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-5xl">
          {state.currentStep === 0 && (
            <WelcomeStep onNext={handleNext} onSkip={handleSkip} />
          )}
          {state.currentStep === 1 && (
            <ProfileStep onNext={handleNext} onBack={handleBack} onSkip={handleSkip} />
          )}
          {state.currentStep === 2 && (
            <FollowStep onNext={handleNext} onBack={handleBack} onSkip={handleSkip} />
          )}
          {state.currentStep === 3 && (
            <NotificationStep onNext={handleNext} onBack={handleBack} onSkip={handleSkip} />
          )}
          {state.currentStep === 4 && (
            <ExploreStep onComplete={handleComplete} onBack={handleBack} />
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-[var(--border)] bg-[var(--muted)] py-4">
        <div className="container mx-auto px-4 text-center text-sm text-[var(--text-muted)]">
          <p>
            Need help? Check out our{" "}
            <a href="/docs" className="text-violet-600 hover:underline">
              documentation
            </a>{" "}
            or join our{" "}
            <a href="/community" className="text-violet-600 hover:underline">
              community
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
