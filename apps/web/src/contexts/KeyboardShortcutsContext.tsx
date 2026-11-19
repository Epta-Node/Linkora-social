"use client";

/**
 * KeyboardShortcutsContext.tsx
 *
 * Global keyboard shortcut manager for Linkora.
 *
 * Provides:
 *   - A React context with shared state (help modal, compose trigger)
 *   - A custom hook `useKeyboardShortcutsContext` for consumers
 *   - `KeyboardShortcutsProvider` that attaches the global keydown listener
 *   - `registerSearchRef` so SearchBar can expose its input for programmatic focus
 *
 * Shortcut behaviour:
 *   n        → open New Post composer
 *   /        → focus global search bar
 *   ?        → open help modal
 *   Escape   → close help modal (other modals handle their own Esc)
 *   g then f → navigate to /feed          (500 ms window between keys)
 *   g then p → navigate to /profile/<addr>
 *   g then s → navigate to /settings
 *
 * Guard: shortcuts are suppressed when focus is inside an input, textarea,
 * or contenteditable element so normal typing is never interrupted.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/hooks/useWallet";
import { useFeatureFlag } from "@/lib/featureFlags";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface KeyboardShortcutsContextValue {
  /** Whether the `?` help modal is open. */
  isHelpModalOpen: boolean;
  openHelpModal: () => void;
  closeHelpModal: () => void;

  /** Whether the `⌘K / Ctrl+K` command palette is open. */
  isCommandPaletteOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;

  /** Called by NavBar to let the shortcut system open the Compose modal. */
  onOpenCompose: (() => void) | null;
  registerComposeHandler: (handler: () => void) => void;
  unregisterComposeHandler: () => void;

  /** Called by NavBar to let the shortcut system open the Wallet modal. */
  onOpenWallet: (() => void) | null;
  registerWalletHandler: (handler: () => void) => void;
  unregisterWalletHandler: () => void;

  /**
   * Called by SearchBar to register its input ref.
   * The `n` shortcut uses this to programmatically focus the input.
   */
  registerSearchRef: (ref: React.RefObject<HTMLInputElement | null>) => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const KeyboardShortcutsContext = createContext<KeyboardShortcutsContextValue>({
  isHelpModalOpen: false,
  openHelpModal: () => {},
  closeHelpModal: () => {},
  isCommandPaletteOpen: false,
  openCommandPalette: () => {},
  closeCommandPalette: () => {},
  toggleCommandPalette: () => {},
  onOpenCompose: null,
  registerComposeHandler: () => {},
  unregisterComposeHandler: () => {},
  onOpenWallet: null,
  registerWalletHandler: () => {},
  unregisterWalletHandler: () => {},
  registerSearchRef: () => {},
});

export function useKeyboardShortcutsContext(): KeyboardShortcutsContextValue {
  return useContext(KeyboardShortcutsContext);
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/** Multi-key sequence timeout in milliseconds. */
const SEQUENCE_TIMEOUT_MS = 500;

/**
 * Returns true when the keyboard event originated from an editable element.
 * Shortcuts must be suppressed in these cases so normal typing is unaffected.
 */
function isEditableTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target || !target.tagName) return false;

  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;

  if (target.isContentEditable) return true;

  if (target.getAttribute) {
    const ce = target.getAttribute("contenteditable");
    if (ce !== null && ce !== "false") return true;

    if (target.getAttribute("role") === "textbox") return true;
  }

  return false;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function KeyboardShortcutsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { address } = useWallet();
  const commandPaletteEnabled = useFeatureFlag("command-palette");

  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Refs for cross-component communication (avoid stale closures)
  const composeHandlerRef = useRef<(() => void) | null>(null);
  const walletHandlerRef = useRef<(() => void) | null>(null);
  const searchInputRef = useRef<React.RefObject<HTMLInputElement | null> | null>(null);

  // Pending first key of a two-key sequence ("g …")
  const pendingKeyRef = useRef<string | null>(null);
  const sequenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Context callbacks ────────────────────────────────────────────────────

  const openHelpModal = useCallback(() => setIsHelpModalOpen(true), []);
  const closeHelpModal = useCallback(() => setIsHelpModalOpen(false), []);

  const openCommandPalette = useCallback(() => setIsCommandPaletteOpen(true), []);
  const closeCommandPalette = useCallback(() => setIsCommandPaletteOpen(false), []);
  const toggleCommandPalette = useCallback(() => setIsCommandPaletteOpen((prev) => !prev), []);

  const registerComposeHandler = useCallback((handler: () => void) => {
    composeHandlerRef.current = handler;
  }, []);

  const unregisterComposeHandler = useCallback(() => {
    composeHandlerRef.current = null;
  }, []);

  const registerWalletHandler = useCallback((handler: () => void) => {
    walletHandlerRef.current = handler;
  }, []);

  const unregisterWalletHandler = useCallback(() => {
    walletHandlerRef.current = null;
  }, []);

  const registerSearchRef = useCallback((ref: React.RefObject<HTMLInputElement | null>) => {
    searchInputRef.current = ref;
  }, []);

  // ── Sequence helpers ─────────────────────────────────────────────────────

  const clearSequence = useCallback(() => {
    if (sequenceTimerRef.current !== null) {
      clearTimeout(sequenceTimerRef.current);
      sequenceTimerRef.current = null;
    }
    pendingKeyRef.current = null;
  }, []);

  const startSequenceTimer = useCallback(() => {
    if (sequenceTimerRef.current !== null) clearTimeout(sequenceTimerRef.current);
    sequenceTimerRef.current = setTimeout(clearSequence, SEQUENCE_TIMEOUT_MS);
  }, [clearSequence]);

  // ── Global keydown handler ───────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // ⌘K (macOS) / Ctrl+K (Windows/Linux) opens command palette from anywhere,
      // including when focus is inside an input, textarea, or contenteditable.
      const isCmdK = (event.metaKey || event.ctrlKey) && (event.key === "k" || event.key === "K");

      if (isCmdK) {
        event.preventDefault();
        event.stopPropagation();
        clearSequence();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

      // ⌘N (macOS) / Ctrl+N (Windows/Linux) opens the compose modal from anywhere,
      // overriding the browser's default "new window / new tab" behaviour.
      const isCmdN = (event.metaKey || event.ctrlKey) && (event.key === "n" || event.key === "N");

      if (isCmdN) {
        event.preventDefault();
        event.stopPropagation();
        clearSequence();
        composeHandlerRef.current?.();
        return;
      }

      // Never intercept when typing in an editable element
      if (isEditableTarget(event)) {
        clearSequence();
        return;
      }

      // Ignore modifier combos (Ctrl+/, Alt+n, etc.)
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const key = event.key;

      // ── Resolve pending sequence ─────────────────────────────────────────
      if (pendingKeyRef.current === "g") {
        clearSequence();

        switch (key) {
          case "f":
            event.preventDefault();
            router.push("/feed");
            return;
          case "p": {
            event.preventDefault();
            const dest = address ? `/profile/${address}` : "/profile";
            router.push(dest);
            return;
          }
          case "s":
            event.preventDefault();
            router.push("/settings");
            return;
          default:
            // Unrecognised second key — sequence cancelled, fall through
            return;
        }
      }

      // ── Single-key shortcuts ─────────────────────────────────────────────
      switch (key) {
        case "n":
          event.preventDefault();
          composeHandlerRef.current?.();
          break;

        case "/":
          event.preventDefault();
          searchInputRef.current?.current?.focus();
          break;

        case "?":
          event.preventDefault();
          setIsHelpModalOpen((prev) => !prev);
          break;

        case "Escape":
          // Close command palette and help modal if open
          setIsHelpModalOpen(false);
          setIsCommandPaletteOpen(false);
          break;

        case "g":
          // Start two-key sequence
          event.preventDefault();
          pendingKeyRef.current = "g";
          startSequenceTimer();
          break;

        default:
          break;
      }
    },
    [router, address, clearSequence, startSequenceTimer]
  );

  // ── Attach / detach listener ─────────────────────────────────────────────

  useEffect(() => {
    if (!commandPaletteEnabled) return;
    // capture: true ensures we see the event before React's synthetic system,
    // which matters for Escape already handled by modals lower in the tree.
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      clearSequence();
    };
  }, [handleKeyDown, clearSequence, commandPaletteEnabled]);

  // ── Context value ────────────────────────────────────────────────────────

  const contextValue: KeyboardShortcutsContextValue = {
    isHelpModalOpen,
    openHelpModal,
    closeHelpModal,
    isCommandPaletteOpen,
    openCommandPalette,
    closeCommandPalette,
    toggleCommandPalette,
    onOpenCompose: composeHandlerRef.current,
    registerComposeHandler,
    unregisterComposeHandler,
    onOpenWallet: walletHandlerRef.current,
    registerWalletHandler,
    unregisterWalletHandler,
    registerSearchRef,
  };

  return (
    <KeyboardShortcutsContext.Provider value={contextValue}>
      {children}
    </KeyboardShortcutsContext.Provider>
  );
}
