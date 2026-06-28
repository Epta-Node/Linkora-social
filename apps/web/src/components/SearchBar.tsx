"use client";

import { FormEvent, KeyboardEvent, Ref, useEffect, useMemo, useRef, useState } from "react";
import { validateSearchQuery } from "@/lib/validate";
import { SearchSuggestion, useSearchSuggestions } from "@/hooks/useSearchSuggestions";
import { useRecentSearches } from "@/hooks/useRecentSearches";

interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
  initialValue?: string;
  className?: string;
  inputClassName?: string;
  buttonLabel?: string;
  inputRef?: Ref<HTMLInputElement>;
}

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") {
        ref(node);
      } else {
        try {
          (ref as { current: T | null }).current = node;
        } catch {
          // Ignore readonly refs.
        }
      }
    }
  };
}

function highlightMatch(text: string, search: string) {
  const trimmed = search.trim();
  if (!trimmed) return text;

  const pattern = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${pattern})`, "gi"));

  return parts.map((part, index) =>
    part.toLowerCase() === trimmed.toLowerCase() ? (
      <mark
        key={`${part}-${index}`}
        className="rounded bg-violet-500/30 px-1 font-semibold text-white"
      >
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function getSuggestionLabel(suggestion: SearchSuggestion): string {
  return suggestion.displayName || suggestion.value;
}

export default function SearchBar({
  onSearch,
  placeholder = "Search posts and profiles",
  initialValue = "",
  className = "w-full max-w-md",
  inputClassName = "",
  buttonLabel = "Search",
  inputRef,
}: SearchBarProps) {
  const [query, setQuery] = useState(initialValue);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const localInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const mergedInputRef = useMemo(() => mergeRefs(localInputRef, inputRef), [inputRef]);

  const { suggestions, loading, fetchSuggestions, clearSuggestions } = useSearchSuggestions();
  const { recentSearches, addRecentSearch, clearRecentSearches, removeRecentSearch } =
    useRecentSearches();

  useEffect(() => {
    setQuery(initialValue);
  }, [initialValue]);

  useEffect(() => {
    if (!focused) {
      clearSuggestions();
      setActiveIndex(-1);
      return;
    }

    if (!query.trim()) {
      clearSuggestions();
      setActiveIndex(-1);
      return;
    }

    setActiveIndex(-1);
    fetchSuggestions(query);
  }, [clearSuggestions, fetchSuggestions, focused, query]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        !localInputRef.current?.contains(target)
      ) {
        setFocused(false);
        setActiveIndex(-1);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentSuggestions = query.trim()
    ? suggestions
    : recentSearches.map((value) => ({ type: "recent" as const, value }));

  const showDropdown = focused && (loading || currentSuggestions.length > 0);

  const submitSearch = (value: string) => {
    const trimmed = value.trim();
    if (!validateSearchQuery(trimmed).valid) return;

    addRecentSearch(trimmed);
    onSearch(trimmed);
    setFocused(false);
    setActiveIndex(-1);
    clearSuggestions();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitSearch(query);
  };

  const handleSuggestionSelect = (suggestion: SearchSuggestion) => {
    const nextQuery = getSuggestionLabel(suggestion);
    setQuery(nextQuery);
    submitSearch(nextQuery);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!currentSuggestions.length) {
      if (event.key === "Escape") {
        setFocused(false);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, currentSuggestions.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, -1));
      return;
    }

    if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      handleSuggestionSelect(currentSuggestions[activeIndex]);
      return;
    }

    if (event.key === "Escape") {
      setFocused(false);
      setActiveIndex(-1);
    }
  };

  const isQueryValid = validateSearchQuery(query).valid;

  return (
    <div className={`relative ${className}`}>
      <form onSubmit={handleSubmit} role="search">
        <div className="relative">
          <input
            ref={mergedInputRef}
            type="text"
            role="combobox"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setFocused(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            aria-label={placeholder}
            aria-expanded={showDropdown}
            aria-autocomplete="list"
            aria-controls="search-suggestions"
            aria-activedescendant={activeIndex >= 0 ? `suggestion-${activeIndex}` : undefined}
            className={`w-full rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 pr-20 text-[var(--foreground)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-violet-500 ${inputClassName}`}
          />
          <button
            type="submit"
            disabled={!isQueryValid}
            aria-label="Submit search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded bg-violet-600 px-3 py-1 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
          >
            {buttonLabel}
          </button>
        </div>
      </form>

      {showDropdown && (
        <div
          ref={dropdownRef}
          id="search-suggestions"
          role="listbox"
          className="absolute z-50 mt-2 max-h-80 w-full overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg"
        >
          {loading && query.trim() ? (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-[var(--text-muted)]">
              <svg
                className="h-4 w-4 animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Loading suggestions...
            </div>
          ) : null}

          {!query.trim() && recentSearches.length > 0 && (
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Recent Searches
              </span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  clearRecentSearches();
                }}
                className="text-xs font-medium text-violet-400 transition-colors hover:text-violet-300"
                aria-label="Clear recent searches"
              >
                Clear recent
              </button>
            </div>
          )}

          {currentSuggestions.map((suggestion, index) => {
            const selected = index === activeIndex;
            const label = getSuggestionLabel(suggestion);

            return (
              <div
                key={`${suggestion.type}-${suggestion.value}-${index}`}
                id={`suggestion-${index}`}
                role="option"
                aria-selected={selected}
                onClick={() => handleSuggestionSelect(suggestion)}
                className={`flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--muted)] ${
                  selected ? "bg-[var(--muted)]" : ""
                }`}
              >
                <div className="flex-shrink-0">
                  {suggestion.type === "profile" && (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 text-sm font-semibold text-white">
                      {label.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  {suggestion.type === "hashtag" && (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-500/20 text-violet-400">
                      #
                    </div>
                  )}
                  {suggestion.type === "recent" && (
                    <div className="flex h-8 w-8 items-center justify-center text-[var(--text-muted)]">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                        className="h-5 w-5"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[var(--foreground)]">
                    {query.trim() && suggestion.type !== "recent"
                      ? highlightMatch(label, query)
                      : label}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {suggestion.type === "profile"
                      ? "Profile"
                      : suggestion.type === "hashtag"
                        ? "Hashtag"
                        : "Recent search"}
                  </div>
                </div>

                {suggestion.type === "recent" && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeRecentSearch(suggestion.value);
                    }}
                    className="flex-shrink-0 p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--foreground)]"
                    aria-label={`Remove ${suggestion.value} from recent searches`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      className="h-4 w-4"
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
