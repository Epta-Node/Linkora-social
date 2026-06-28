import { useState, useCallback, useRef, useEffect } from "react";

export interface SearchSuggestion {
  type: "profile" | "hashtag" | "recent";
  value: string;
  displayName?: string;
  avatar?: string;
}

interface UseSearchSuggestionsOptions {
  debounceMs?: number;
  minQueryLength?: number;
  maxSuggestions?: number;
}

const INDEXER_API_URL = process.env.NEXT_PUBLIC_INDEXER_API_URL ?? "http://localhost:3001";

export function useSearchSuggestions({
  debounceMs = 300,
  minQueryLength = 2,
  maxSuggestions = 5,
}: UseSearchSuggestionsOptions = {}) {
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = useCallback(
    async (query: string) => {
      const trimmed = query.trim();

      if (!trimmed || trimmed.length < minQueryLength) {
        setSuggestions([]);
        return;
      }

      // Cancel previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      setLoading(true);

      try {
        // Fetch profiles
        const profilesResponse = await fetch(
          `${INDEXER_API_URL}/api/profiles/search?q=${encodeURIComponent(trimmed)}&limit=${maxSuggestions}&offset=0`,
          { signal: abortControllerRef.current.signal }
        );

        if (!profilesResponse.ok) {
          throw new Error("Failed to fetch suggestions");
        }

        const profilesData = await profilesResponse.json();
        const profiles = Array.isArray(profilesData) ? profilesData : profilesData.profiles || [];

        const newSuggestions: SearchSuggestion[] = [
          ...profiles
            .slice(0, maxSuggestions)
            .map((profile: { address: string; username?: string; display_name?: string }) => ({
              type: "profile" as const,
              value: profile.address,
              displayName: profile.display_name || profile.username || profile.address,
              avatar: undefined,
            })),
        ];

        // Add hashtag suggestion if query starts with #
        if (trimmed.startsWith("#")) {
          newSuggestions.unshift({
            type: "hashtag" as const,
            value: trimmed,
            displayName: trimmed,
          });
        }

        setSuggestions(newSuggestions);
      } catch (error: unknown) {
        if (error instanceof Error && error.name !== "AbortError") {
          console.error("Failed to fetch suggestions:", error);
          setSuggestions([]);
        }
      } finally {
        setLoading(false);
      }
    },
    [minQueryLength, maxSuggestions]
  );

  const debouncedFetch = useCallback(
    (query: string) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      if (!query.trim()) {
        setSuggestions([]);
        return;
      }

      debounceTimerRef.current = setTimeout(() => {
        fetchSuggestions(query);
      }, debounceMs);
    },
    [debounceMs, fetchSuggestions]
  );

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    suggestions,
    loading,
    fetchSuggestions: debouncedFetch,
    clearSuggestions,
  };
}
