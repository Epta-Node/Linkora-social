import { useState, useEffect, useCallback } from "react";

const RECENT_SEARCHES_KEY = "linkora_recent_searches";
const MAX_RECENT_SEARCHES = 10;

export function useRecentSearches(maxSearches = MAX_RECENT_SEARCHES) {
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  // Load recent searches from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setRecentSearches(parsed.slice(0, maxSearches));
        }
      }
    } catch (error) {
      console.error("Failed to load recent searches:", error);
    }
  }, [maxSearches]);

  // Save a search to recent searches
  const addRecentSearch = useCallback(
    (searchQuery: string) => {
      const trimmed = searchQuery.trim();
      if (!trimmed) return;

      setRecentSearches((prev: string[]) => {
        // Remove duplicates and add to front
        const filtered = prev.filter((item: string) => item !== trimmed);
        const updated = [trimmed, ...filtered].slice(0, maxSearches);

        // Save to localStorage
        try {
          localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
        } catch (error) {
          console.error("Failed to save recent searches:", error);
        }

        return updated;
      });
    },
    [maxSearches]
  );

  // Clear all recent searches
  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    try {
      localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch (error) {
      console.error("Failed to clear recent searches:", error);
    }
  }, []);

  // Remove a specific recent search
  const removeRecentSearch = useCallback((searchQuery: string) => {
    setRecentSearches((prev: string[]) => {
      const updated = prev.filter((item: string) => item !== searchQuery);

      try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      } catch (error) {
        console.error("Failed to update recent searches:", error);
      }

      return updated;
    });
  }, []);

  return {
    recentSearches,
    addRecentSearch,
    clearRecentSearches,
    removeRecentSearch,
  };
}
