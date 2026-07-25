"use client";

/**
 * KeyboardShortcutsSection.tsx
 *
 * Settings section that documents all available keyboard shortcuts.
 * Read-only — no interactive controls.
 * Matches the visual pattern of WalletSection / ThemeSection.
 */

import React from "react";
import { SHORTCUTS, SHORTCUT_GROUPS, formatKeys } from "@/lib/keyboardShortcuts";

export function KeyboardShortcutsSection() {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-xl font-semibold mb-1">Keyboard Shortcuts</h2>
      <p className="text-sm text-gray-600 mb-5">
        Speed up your workflow with these power-user shortcuts. Press{" "}
        <kbd className="inline-flex items-center px-1.5 py-0.5 rounded border border-gray-300 bg-gray-100 text-xs font-mono font-semibold text-gray-700 shadow-sm">
          ?
        </kbd>{" "}
        anywhere to open this reference.
      </p>

      <div className="space-y-6">
        {SHORTCUT_GROUPS.map((group) => {
          const groupShortcuts = SHORTCUTS.filter((s) => s.group === group);
          if (groupShortcuts.length === 0) return null;

          return (
            <div key={group}>
              {/* Group heading */}
              <p className="text-xs font-bold uppercase tracking-widest text-violet-600 mb-2">
                {group}
              </p>

              <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 overflow-hidden">
                {groupShortcuts.map((shortcut) => (
                  <div
                    key={shortcut.keys.join("+")}
                    className="flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
                  >
                    {/* Description */}
                    <span className="text-sm text-gray-700">{shortcut.label}</span>

                    {/* Key sequence */}
                    <span
                      className="flex items-center gap-1 shrink-0 ml-4"
                      aria-label={formatKeys(shortcut.keys)}
                    >
                      {shortcut.keys.map((key, i) => (
                        <React.Fragment key={key}>
                          {i > 0 && (
                            <span className="text-xs text-gray-400 mx-0.5" aria-hidden="true">
                              then
                            </span>
                          )}
                          <kbd className="inline-flex items-center justify-center min-w-[28px] px-1.5 py-0.5 rounded border border-gray-300 bg-white text-xs font-mono font-semibold text-gray-800 shadow-sm">
                            {key === "Escape" ? "Esc" : key}
                          </kbd>
                        </React.Fragment>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
