/**
 * Hook to sync onboarding profile data with the actual profile system
 * This is a bridge between the onboarding wizard and the main profile creation
 */

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "./useWallet";

interface ProfileDraft {
  username: string;
  displayName: string;
  bio: string;
  avatar: string;
  address: string;
}

export function useOnboardingProfile() {
  const { address } = useWallet();
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [loading, setLoading] = useState(false);

  // Load draft from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("linkora_profile_draft");
    if (stored) {
      try {
        setDraft(JSON.parse(stored));
      } catch (error) {
        console.warn("Failed to parse profile draft", error);
      }
    }
  }, []);

  /**
   * Save profile draft to localStorage
   */
  const saveDraft = useCallback((data: Partial<ProfileDraft>) => {
    const newDraft = { ...draft, ...data } as ProfileDraft;
    setDraft(newDraft);
    localStorage.setItem("linkora_profile_draft", JSON.stringify(newDraft));
  }, [draft]);

  /**
   * Submit profile to the contract
   * TODO: Replace with actual contract call
   */
  const submitProfile = useCallback(async () => {
    if (!draft || !address) {
      throw new Error("No draft or address available");
    }

    setLoading(true);
    try {
      // TODO: Call contract set_profile method
      console.log("Submitting profile to contract:", draft);

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Clear draft on success
      localStorage.removeItem("linkora_profile_draft");
      setDraft(null);

      return true;
    } catch (error) {
      console.error("Failed to submit profile", error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [draft, address]);

  /**
   * Clear profile draft
   */
  const clearDraft = useCallback(() => {
    localStorage.removeItem("linkora_profile_draft");
    setDraft(null);
  }, []);

  /**
   * Check if user has a draft profile
   */
  const hasDraft = Boolean(draft);

  return {
    draft,
    hasDraft,
    loading,
    saveDraft,
    submitProfile,
    clearDraft,
  };
}
