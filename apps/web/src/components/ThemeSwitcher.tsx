"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import type { ThemePreference } from "@/components/ThemeBootstrap";

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  const commonProps = {
    xmlns: "http://www.w3.org/2000/svg",
    fill: "none",
    viewBox: "0 0 24 24",
    strokeWidth: 1.5,
    stroke: "currentColor",
    "aria-hidden": true,
    className: "h-5 w-5",
  } as const;

  if (preference === "light") {
    return (
      <svg {...commonProps} data-theme-icon="light">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
        />
      </svg>
    );
  }

  if (preference === "dark") {
    return (
      <svg {...commonProps} data-theme-icon="dark">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
        />
      </svg>
    );
  }

  return (
    <svg {...commonProps} data-theme-icon="system">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 17.25h6m-9.75 3h13.5A2.25 2.25 0 0 0 21 18V6.75A2.25 2.25 0 0 0 18.75 4.5H5.25A2.25 2.25 0 0 0 3 6.75V18a2.25 2.25 0 0 0 2.25 2.25Z"
      />
    </svg>
  );
}

export function ThemeSwitcher() {
  const { preference, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = OPTIONS.find((option) => option.value === preference) ?? OPTIONS[2];

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="rounded-lg p-1.5 text-[var(--text-muted)] hover:text-violet-400 transition-colors"
        aria-label={`Theme: ${selected.label}. Change theme`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={`Theme: ${selected.label}`}
        data-testid="theme-switcher"
      >
        <ThemeIcon preference={preference} />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Choose theme"
          className="absolute right-0 z-50 mt-2 w-36 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] py-1 shadow-xl"
          data-testid="theme-switcher-menu"
        >
          {OPTIONS.map((option) => {
            const isSelected = option.value === preference;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => {
                  setTheme(option.value);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--bg-tertiary)] ${
                  isSelected ? "font-semibold text-violet-400" : "text-[var(--text-primary)]"
                }`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  {option.value === "light" && (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
                    />
                  )}
                  {option.value === "dark" && (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
                    />
                  )}
                  {option.value === "system" && (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 17.25h6m-9.75 3h13.5A2.25 2.25 0 0 0 21 18V6.75A2.25 2.25 0 0 0 18.75 4.5H5.25A2.25 2.25 0 0 0 3 6.75V18a2.25 2.25 0 0 0 2.25 2.25Z"
                    />
                  )}
                </svg>
                <span className="flex-1">{option.label}</span>
                {isSelected && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    strokeWidth={2}
                    stroke="currentColor"
                    className="h-4 w-4"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
