"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { OnboardingWizard } from "@/components/onboarding/wizard/OnboardingWizard";
import { useOnboarding } from "@/contexts/OnboardingContext";
import { useWallet } from "@/hooks/useWallet";

export default function OnboardingPage() {
  const router = useRouter();
  const { state, shouldShowOnboarding } = useOnboarding();
  const { connected } = useWallet();

  useEffect(() => {
    // Redirect if onboarding is complete
    if (!shouldShowOnboarding()) {
      router.push("/feed");
    }
  }, [state.isComplete, state.skipped, shouldShowOnboarding, router]);

  // Redirect if not connected
  useEffect(() => {
    if (!connected) {
      router.push("/");
    }
  }, [connected, router]);

  if (!shouldShowOnboarding() || !connected) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-[var(--text-muted)]">Loading...</div>
      </div>
    );
  }

  return <OnboardingWizard />;
}
