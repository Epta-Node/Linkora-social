'use client';

import { FormEvent, useEffect, useState } from 'react';
import { validateSearchQuery } from '@/lib/validate';

interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
  initialValue?: string;
  className?: string;
  inputClassName?: string;
  buttonLabel?: string;
}

export default function SearchBar({
  onSearch,
  placeholder = "Search posts...",
  initialValue = "",
  className = "w-full max-w-md",
  inputClassName = "",
  buttonLabel = "Search",
}: SearchBarProps) {
  const [query, setQuery] = useState(initialValue);

  useEffect(() => {
    setQuery(initialValue);
  }, [initialValue]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!validateSearchQuery(trimmed).valid) return;
    onSearch(trimmed);
  };

  return (
    <form onSubmit={handleSubmit} className={className} role="search">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className={`w-full rounded-lg border border-[var(--border)] bg-[var(--muted)] px-4 py-2 pr-24 text-[var(--foreground)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-violet-500 ${inputClassName}`}
        />
        <button
          type="submit"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-violet-600 px-3 py-1 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
          disabled={!validateSearchQuery(query).valid}
        >
          {buttonLabel}
        </button>
      </div>
    </form>
  );
}
