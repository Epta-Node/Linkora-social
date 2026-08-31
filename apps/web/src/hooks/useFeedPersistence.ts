"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Post } from "@/components/PostCard";

const STORAGE_KEY_PREFIX = "linkora_feed_";
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedFeed {
  posts: Post[];
  activeTab: "following" | "explore";
  scrollY: number;
  cursor: number | null;
  hasMore: boolean;
  timestamp: number;
}

function getStorageKey(tab: string): string {
  return `${STORAGE_KEY_PREFIX}${tab}`;
}

export function readCachedFeed(tab: "following" | "explore"): CachedFeed | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(getStorageKey(tab));
    if (!raw) return null;
    const parsed: CachedFeed = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(getStorageKey(tab));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedFeed(tab: "following" | "explore", data: Omit<CachedFeed, "timestamp">) {
  if (typeof window === "undefined") return;
  try {
    const payload: CachedFeed = { ...data, timestamp: Date.now() };
    localStorage.setItem(getStorageKey(tab), JSON.stringify(payload));
  } catch {
    // storage full or unavailable — silently drop
  }
}

export function clearCachedFeed(tab: "following" | "explore") {
  if (typeof window === "undefined") return;
  localStorage.removeItem(getStorageKey(tab));
}

export function useFeedPersistence(activeTab: "following" | "explore") {
  const [isOffline, setIsOffline] = useState(false);
  const [servedFromCache, setServedFromCache] = useState(false);
  const scrollRestoredRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsOffline(!navigator.onLine);

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const restoreScroll = useCallback(() => {
    if (scrollRestoredRef.current) return;
    const cached = readCachedFeed(activeTab);
    if (cached && cached.scrollY > 0) {
      requestAnimationFrame(() => {
        window.scrollTo({ top: cached.scrollY, behavior: "instant" });
      });
    }
    scrollRestoredRef.current = true;
  }, [activeTab]);

  useEffect(() => {
    scrollRestoredRef.current = false;
  }, [activeTab]);

  const persistFeed = useCallback(
    (data: { posts: Post[]; cursor: number | null; hasMore: boolean }) => {
      writeCachedFeed(activeTab, {
        ...data,
        activeTab,
        scrollY: typeof window !== "undefined" ? window.scrollY : 0,
      });
    },
    [activeTab]
  );

  const getCache = useCallback(() => readCachedFeed(activeTab), [activeTab]);

  const setServedFromCacheState = useCallback((val: boolean) => {
    setServedFromCache(val);
  }, []);

  return {
    isOffline,
    servedFromCache,
    setServedFromCache: setServedFromCacheState,
    restoreScroll,
    persistFeed,
    getCache,
    clearCache: useCallback(() => clearCachedFeed(activeTab), [activeTab]),
  };
}
