"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useOnboarding } from "@/contexts/OnboardingContext";
import { useWallet } from "@/hooks/useWallet";

/**
 * OnboardingGuard checks if a new user should be redirected to onboarding
 * Place this in pages where you want to enforce onboarding completion
 */
export function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { shouldShowOnboarding } = useOnboarding();
  const { connected, address } = useWallet();

  useEffect(() => {
    // Skip if we're already on onboarding page
    if (pathname === "/onboarding") {
      return;
    }

    // Only check if user is connected
    if (connected && address) {
      // Check if user needs onboarding
      if (shouldShowOnboarding()) {
        // Check if this is their first time (no profile data)
        const hasProfileDraft = localStorage.getItem("linkora_profile_draft");

        if (!hasProfileDraft) {
          // New user - redirect to onboarding
          router.push("/onboarding");
        }
      }
    }
  }, [connected, address, pathname, shouldShowOnboarding, router]);

  return <>{children}</>;
}
