"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export const GUIDED_TOUR_STORAGE_KEY = "linkora_guided_tour_dismissed";

export interface TourStep {
  id: string;
  target: string;
  title: string;
  description: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "feed",
    target: '[data-tour="feed"]',
    title: "Your Feed",
    description: "This is your feed — posts from creators you follow",
  },
  {
    id: "post-actions",
    target: '[data-tour="post-actions"]',
    title: "Like & Tip",
    description: "Tap the heart to like, or send a tip with the coin icon",
  },
  {
    id: "pools",
    target: '[data-tour="pools"]',
    title: "Community Pools",
    description: "Join community pools to earn rewards",
  },
  {
    id: "governance",
    target: '[data-tour="governance"]',
    title: "Governance",
    description: "Vote on governance proposals",
  },
  {
    id: "mini-apps",
    target: '[data-tour="mini-apps"]',
    title: "Mini Apps",
    description: "Explore mini-apps in the sidebar",
  },
];

interface GuidedTourContextValue {
  dismissed: boolean;
  active: boolean;
  stepIndex: number;
  currentStep: TourStep;
  next: () => void;
  prev: () => void;
  dismiss: () => void;
  resetTour: () => void;
  totalSteps: number;
}

const GuidedTourContext = createContext<GuidedTourContextValue | null>(null);

export function GuidedTourProvider({ children }: { children: React.ReactNode }) {
  const [dismissed, setDismissed] = useState(true);
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(GUIDED_TOUR_STORAGE_KEY);
    const isE2E =
      typeof window !== "undefined" &&
      (!!window.navigator.webdriver ||
        window.navigator.userAgent.includes("Headless") ||
        window.navigator.userAgent.includes("Playwright") ||
        process.env.NEXT_PUBLIC_SOROBAN_RPC_URL !== undefined ||
        process.env.NODE_ENV === "test");
    const isDismissed = stored === "true" || (stored === null && isE2E);
    setDismissed(isDismissed);
    if (!isDismissed) {
      setActive(true);
    }
    setMounted(true);
  }, []);

  const dismiss = useCallback(() => {
    localStorage.setItem(GUIDED_TOUR_STORAGE_KEY, "true");
    setDismissed(true);
    setActive(false);
  }, []);

  const next = useCallback(() => {
    if (stepIndex < TOUR_STEPS.length - 1) {
      setStepIndex(stepIndex + 1);
      return;
    }
    dismiss();
  }, [stepIndex, dismiss]);

  const prev = useCallback(() => {
    setStepIndex((index) => Math.max(0, index - 1));
  }, []);

  const resetTour = useCallback(() => {
    localStorage.removeItem(GUIDED_TOUR_STORAGE_KEY);
    setDismissed(false);
    setStepIndex(0);
    setActive(true);
  }, []);

  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <GuidedTourContext.Provider
      value={{
        dismissed,
        active,
        stepIndex,
        currentStep: TOUR_STEPS[stepIndex],
        next,
        prev,
        dismiss,
        resetTour,
        totalSteps: TOUR_STEPS.length,
      }}
    >
      {children}
    </GuidedTourContext.Provider>
  );
}

export function useGuidedTour() {
  return useContext(GuidedTourContext);
}
