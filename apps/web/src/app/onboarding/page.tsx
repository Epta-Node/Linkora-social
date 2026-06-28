"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OnboardingWizard } from "@/components/onboarding/wizard/OnboardingWizard";
import { useWallet } from "@/hooks/useWallet";

const ONBOARDING_STORAGE_KEY = "linkora_onboarding_state";

export default function OnboardingPage() {
  const router = useRouter();
  const { connected } = useWallet();
  const [isComplete, setIsComplete] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
      if (!stored) {
        setIsComplete(false);
        return;
      }

      const parsed = JSON.parse(stored) as { isComplete?: boolean; skipped?: boolean };
      setIsComplete(Boolean(parsed.isComplete || parsed.skipped));
    } catch {
      setIsComplete(false);
    }
  }, []);

  useEffect(() => {
    if (isComplete) {
      router.push("/feed");
    }
  }, [isComplete, router]);

  useEffect(() => {
    if (isComplete === false && !connected) {
      router.push("/");
    }
  }, [connected, isComplete, router]);

  if (isComplete === null || isComplete || !connected) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-[var(--text-muted)]">Loading...</div>
      </div>
    );
  }

  return <OnboardingWizard />;
}
