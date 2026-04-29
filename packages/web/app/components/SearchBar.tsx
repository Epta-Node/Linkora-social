"use client";

import { useState, useEffect } from "react";

interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
}

export function SearchBar({
  onSearch,
  placeholder = "Search by username...",
}: SearchBarProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim()) {
        onSearch(query.trim());
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, onSearch]);

  return (
    <div style={styles.container}>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        style={styles.input}
        aria-label="Search"
      />
      <span style={styles.icon}>🔍</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "relative",
    width: "100%",
    maxWidth: "600px",
    margin: "0 auto var(--spacing-lg)",
  },
  input: {
    width: "100%",
    padding: "var(--spacing-md) var(--spacing-lg)",
    paddingRight: "3rem",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    fontSize: "1rem",
    minHeight: "var(--min-touch-target)",
  },
  icon: {
    position: "absolute",
    right: "var(--spacing-md)",
    top: "50%",
    transform: "translateY(-50%)",
    fontSize: "1.2rem",
    pointerEvents: "none",
  },
};
