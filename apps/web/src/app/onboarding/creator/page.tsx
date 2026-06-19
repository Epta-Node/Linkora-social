"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/hooks/useWallet";
import { CreatorTokenWizard } from "@/components/onboarding/creator/CreatorTokenWizard";

export default function CreatorOnboardingPage() {
  const { address, connected } = useWallet();
  const router = useRouter();

  useEffect(() => {
    if (!connected || !address) {
      router.replace("/");
    }
  }, [connected, address, router]);

  if (!connected || !address) return null;

  return <CreatorTokenWizard deployerAddress={address} />;
}
