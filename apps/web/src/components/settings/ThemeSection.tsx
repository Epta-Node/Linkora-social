"use client";

import { useEffect, useState } from "react";
import {
  getStoredThemePreference,
  storeThemePreference,
  THEMES,
  type ThemePreference,
} from "@/components/ThemeBootstrap";
import { useFeatureFlag } from "@/lib/featureFlags";

export function ThemeSection() {
  const darkModeEnabled = useFeatureFlag("dark-mode-toggle");
  const [theme, setTheme] = useState<ThemePreference>("light");

  useEffect(() => {
    setTheme(getStoredThemePreference());
  }, []);

  function handleThemeChange(nextTheme: ThemePreference) {
    setTheme(nextTheme);
    storeThemePreference(nextTheme);
  }

  // When the dark-mode-toggle flag is off, force light mode and hide the control
  useEffect(() => {
    if (!darkModeEnabled) {
      handleThemeChange("light");
    }
  }, [darkModeEnabled]);

  return (
    <section className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] p-6">
      <h2 className="text-xl font-semibold mb-4 text-[var(--text-primary)]">Appearance</h2>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">Theme</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {darkModeEnabled
              ? "Choose how Linkora looks on this device."
              : "Dark mode is currently unavailable."}
          </p>
        </div>
        {darkModeEnabled && (
          <div
            className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] p-1"
            role="group"
            aria-label="Choose theme"
          >
            {THEMES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => handleThemeChange(option)}
                className={`min-w-[72px] rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                  theme === option
                    ? "bg-violet-600 text-white"
                    : "text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
                }`}
                aria-pressed={theme === option}
              >
                {option.charAt(0).toUpperCase() + option.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
