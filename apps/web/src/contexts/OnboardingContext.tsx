"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

export interface OnboardingState {
  isComplete: boolean;
  currentStep: number;
  completedSteps: {
    welcome: boolean;
    profile: boolean;
    follow: boolean;
    notifications: boolean;
    explore: boolean;
  };
  skipped: boolean;
}

interface OnboardingContextValue {
  state: OnboardingState;
  setStep: (step: number) => void;
  completeStep: (step: keyof OnboardingState["completedSteps"]) => void;
  skipOnboarding: () => void;
  resetOnboarding: () => void;
  shouldShowOnboarding: () => boolean;
}

const ONBOARDING_STORAGE_KEY = "linkora_onboarding_state";

const defaultState: OnboardingState = {
  isComplete: false,
  currentStep: 0,
  completedSteps: {
    welcome: false,
    profile: false,
    follow: false,
    notifications: false,
    explore: false,
  },
  skipped: false,
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<OnboardingState>(defaultState);
  const [mounted, setMounted] = useState(false);

  // Load onboarding state from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setState(parsed);
      } catch (error) {
        console.warn("Failed to parse onboarding state", error);
      }
    }
    setMounted(true);
  }, []);

  // Persist state to localStorage whenever it changes
  useEffect(() => {
    if (mounted) {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
    }
  }, [state, mounted]);

  const setStep = (step: number) => {
    setState((prev: OnboardingState) => ({ ...prev, currentStep: step }));
  };

  const completeStep = (step: keyof OnboardingState["completedSteps"]) => {
    setState((prev: OnboardingState) => {
      const newCompletedSteps = { ...prev.completedSteps, [step]: true };
      const allComplete = Object.values(newCompletedSteps).every((v) => v);

      return {
        ...prev,
        completedSteps: newCompletedSteps,
        isComplete: allComplete,
      };
    });
  };

  const skipOnboarding = () => {
    setState((prev: OnboardingState) => ({
      ...prev,
      isComplete: true,
      skipped: true,
    }));
  };

  const resetOnboarding = () => {
    setState(defaultState);
    localStorage.removeItem(ONBOARDING_STORAGE_KEY);
  };

  const shouldShowOnboarding = () => {
    return !state.isComplete && !state.skipped;
  };

  return (
    <OnboardingContext.Provider
      value={{
        state,
        setStep,
        completeStep,
        skipOnboarding,
        resetOnboarding,
        shouldShowOnboarding,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("useOnboarding must be used within OnboardingProvider");
  }
  return context;
}
