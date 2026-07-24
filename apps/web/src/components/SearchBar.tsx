"use client";

import { FormEvent, useEffect, useState, useRef } from "react";
import { validateSearchQuery } from "@/lib/validate";
import { useSearchSuggestions, SearchSuggestion } from "@/hooks/useSearchSuggestions";
import { useRecentSearches } from "@/hooks/useRecentSearches";

interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
  initialValue?: string;
  className?: string;
  inputClassName?: string;
  buttonLabel?: string;
  /** Optional ref forwarded to the underlying <input> for programmatic focus (e.g. keyboard shortcut). */
  inputRef?: React.Ref<HTMLInputElement>;
}

export default function SearchBar({
  onSearch,
  placeholder = "Search posts...",
  initialValue = "",
  className = "w-full max-w-md",
  inputClassName = "",
  buttonLabel = "Search",
  inputRef: forwardedInputRef,
}: SearchBarProps) {
  const [query, setQuery] = useState(initialValue);
  const [isFocused, setIsFocused] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!forwardedInputRef) return;
    if (typeof forwardedInputRef === "function") {
      forwardedInputRef(inputRef.current);
    } else {
      (forwardedInputRef as any).current = inputRef.current;
    }
  }, [forwardedInputRef]);

  const { suggestions, loading, fetchSuggestions, clearSuggestions } = useSearchSuggestions();
  const { recentSearches, addRecentSearch, clearRecentSearches, removeRecentSearch } =
    useRecentSearches();

  const prevInitialValueRef = useRef(initialValue);
  useEffect(() => {
    if (prevInitialValueRef.current !== initialValue) {
      prevInitialValueRef.current = initialValue;
      setQuery(initialValue);
    }
  }, [initialValue]);

  // Fetch suggestions when query changes and input is focused
  useEffect(() => {
    if (!isFocused) {
      clearSuggestions();
      return;
    }

    if (!query.trim()) {
      clearSuggestions();
      return;
    }

    fetchSuggestions(query);
  }, [query, isFocused, fetchSuggestions, clearSuggestions]);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        !inputRef.current?.contains(event.target as Node)
      ) {
        setIsFocused(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const currentSuggestions = query.trim()
      ? suggestions
      : recentSearches.map((s: string) => ({ type: "recent" as const, value: s }));

    if (!currentSuggestions.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSuggestionIndex((prev: number) =>
        prev < currentSuggestions.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSuggestionIndex((prev: number) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === "Enter") {
      if (activeSuggestionIndex >= 0) {
        e.preventDefault();
        const selected = currentSuggestions[activeSuggestionIndex];
        handleSuggestionClick(selected);
      }
    } else if (e.key === "Escape") {
      setIsFocused(false);
      setActiveSuggestionIndex(-1);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!validateSearchQuery(trimmed).valid) return;
    addRecentSearch(trimmed);
    onSearch(trimmed);
    setIsFocused(false);
    setActiveSuggestionIndex(-1);
  };

  const handleSuggestionClick = (suggestion: SearchSuggestion) => {
    const searchValue =
      suggestion.type === "profile" ? suggestion.displayName || suggestion.value : suggestion.value;
    setQuery(searchValue);
    addRecentSearch(searchValue);
    onSearch(searchValue);
    setIsFocused(false);
    setActiveSuggestionIndex(-1);
  };

  const handleRemoveRecent = (e: React.MouseEvent, searchQuery: string) => {
    e.stopPropagation();
    removeRecentSearch(searchQuery);
  };

  // Highlight matching text
  const highlightMatch = (text: string, search: string) => {
    if (!search.trim()) return text;

    const regex = new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    const parts = text.split(regex);

    return parts.map((part, index) =>
      regex.test(part) ? (
        <mark key={index} className="bg-violet-500/30 text-[var(--foreground)] font-semibold">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  const showDropdown =
    isFocused && (query.trim() ? suggestions.length > 0 || loading : recentSearches.length > 0);
  const currentSuggestions = query.trim()
    ? suggestions
    : recentSearches.map((s: string) => ({ type: "recent" as const, value: s }));

  return (
    <div className={`relative ${className}`}>
      <form onSubmit={handleSubmit} role="search">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            value={query}
            onChange={(e) => {
              setIsFocused(true);
              setQuery(e.target.value);
            }}
            onFocus={() => setIsFocused(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            aria-label={placeholder}
            aria-expanded={showDropdown}
            aria-autocomplete="list"
            aria-controls="search-suggestions"
            aria-activedescendant={
              activeSuggestionIndex >= 0 ? `suggestion-${activeSuggestionIndex}` : undefined
            }
            className={`w-full rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 md:px-4 py-2 pr-20 md:pr-24 text-[var(--foreground)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-violet-500 ${inputClassName}`}
          />
          <button
            type="submit"
            className="absolute right-1.5 md:right-2 top-1/2 -translate-y-1/2 rounded bg-violet-600 px-2 md:px-3 py-1 text-xs md:text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50 transition-colors"
            disabled={!validateSearchQuery(query).valid}
            aria-label="Submit search"
          >
            {buttonLabel}
          </button>
        </div>
      </form>

      {/* Suggestions Dropdown */}
      {showDropdown && (
        <div
          ref={dropdownRef}
          id="search-suggestions"
          role="listbox"
          className="absolute z-50 mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg max-h-80 overflow-y-auto"
        >
          {loading && query.trim() && (
            <div className="px-4 py-3 text-sm text-[var(--text-muted)] flex items-center gap-2">
              <svg
                className="animate-spin h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              Loading suggestions...
            </div>
          )}

          {!query.trim() && recentSearches.length > 0 && (
            <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)]">
              <span className="text-xs font-semibold text-[var(--text-muted)] uppercase">
                Recent Searches
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  clearRecentSearches();
                }}
                className="text-xs text-violet-500 hover:text-violet-400 font-medium transition-colors"
                aria-label="Clear recent searches"
              >
                Clear recent
              </button>
            </div>
          )}

          {currentSuggestions.map((suggestion: SearchSuggestion, index: number) => (
            <button
              key={`${suggestion.type}-${suggestion.value}-${index}`}
              id={`suggestion-${index}`}
              role="option"
              aria-selected={index === activeSuggestionIndex}
              type="button"
              onClick={() => handleSuggestionClick(suggestion)}
              className={`w-full px-4 py-3 text-left hover:bg-[var(--muted)] transition-colors flex items-center gap-3 ${
                index === activeSuggestionIndex ? "bg-[var(--muted)]" : ""
              }`}
            >
              {/* Icon */}
              <div className="flex-shrink-0">
                {suggestion.type === "profile" && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-white text-sm font-semibold">
                    {(suggestion.displayName || suggestion.value)[0].toUpperCase()}
                  </div>
                )}
                {suggestion.type === "hashtag" && (
                  <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-500">
                    <span className="text-lg font-bold">#</span>
                  </div>
                )}
                {suggestion.type === "recent" && (
                  <div className="w-8 h-8 flex items-center justify-center text-[var(--text-muted)]">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      className="w-5 h-5"
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

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--foreground)] truncate">
                  {query.trim() && suggestion.type !== "recent"
                    ? highlightMatch(suggestion.displayName || suggestion.value, query)
                    : suggestion.displayName || suggestion.value}
                </div>
                {suggestion.type === "profile" && (
                  <div className="text-xs text-[var(--text-muted)] truncate">Profile</div>
                )}
                {suggestion.type === "hashtag" && (
                  <div className="text-xs text-[var(--text-muted)]">Hashtag</div>
                )}
              </div>

              {/* Remove button for recent searches */}
              {suggestion.type === "recent" && (
                <button
                  type="button"
                  onClick={(e) => handleRemoveRecent(e, suggestion.value)}
                  className="flex-shrink-0 p-1 text-[var(--text-muted)] hover:text-[var(--foreground)] transition-colors"
                  aria-label={`Remove ${suggestion.value} from recent searches`}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="w-4 h-4"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
