"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface PostDraft {
  content: string;
  linkUrl?: string;
  updatedAt: number;
}

const DRAFT_KEY = "create_post_draft";
const AUTO_SAVE_INTERVAL_MS = 5000;

export function useDraft() {
  const [draft, setDraft] = useState<PostDraft | null>(null);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const pendingDraftRef = useRef<{ content: string; linkUrl?: string } | null>(null);

  // Load initial draft from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const parsed: PostDraft = JSON.parse(saved);
        setDraft(parsed);
        setLastSaved(parsed.updatedAt);
      }
    } catch (e) {
      console.warn("Failed to load post draft from localStorage:", e);
    }
  }, []);

  const saveDraft = useCallback((content: string, linkUrl?: string) => {
    pendingDraftRef.current = { content, linkUrl };
  }, []);

  const clearDraft = useCallback(() => {
    pendingDraftRef.current = null;
    setDraft(null);
    setLastSaved(null);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (e) {
      console.warn("Failed to remove post draft from localStorage:", e);
    }
  }, []);

  // Debounced auto-save timer every 5 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      if (pendingDraftRef.current) {
        const { content, linkUrl } = pendingDraftRef.current;
        if (content.trim().length > 0 || (linkUrl && linkUrl.trim().length > 0)) {
          const now = Date.now();
          const draftData: PostDraft = {
            content,
            linkUrl,
            updatedAt: now,
          };
          try {
            localStorage.setItem(DRAFT_KEY, JSON.stringify(draftData));
            setDraft(draftData);
            setLastSaved(now);
          } catch (e) {
            console.warn("Failed to save draft:", e);
          }
        }
      }
    }, AUTO_SAVE_INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  return {
    draft,
    lastSaved,
    saveDraft,
    clearDraft,
  };
}
