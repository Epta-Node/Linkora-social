"use client";

/**
 * Shared, event-driven store for the user's blocked-accounts list.
 *
 * Backed by localStorage so the list survives refreshes, and emits a
 * `linkora:blocked:changed` DOM event whenever the set changes so that any open
 * panel (settings block list, follow list, profile card) can refresh
 * immediately — fixing the stale block-list issue where a block/unblock from
 * one surface was not reflected in another until a manual page refresh.
 */

export const BLOCKED_STORAGE_KEY = "linkora_blocked_accounts";

export const BLOCKED_EVENT = "linkora:blocked:changed";

export function readBlockedList(): string[] {
  if (typeof window === "undefined") return [];
  const stored = window.localStorage.getItem(BLOCKED_STORAGE_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function notifyChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(BLOCKED_EVENT));
}

export function writeBlockedList(list: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BLOCKED_STORAGE_KEY, JSON.stringify(list));
  notifyChanged();
}

/** Add an address to the blocked list (idempotent). Returns true when added. */
export function addToBlockedList(address: string): boolean {
  const current = readBlockedList();
  if (current.includes(address)) return false;
  writeBlockedList([...current, address]);
  return true;
}

/** Remove an address from the blocked list. Returns true when removed. */
export function removeFromBlockedList(address: string): boolean {
  const current = readBlockedList();
  const next = current.filter((addr) => addr !== address);
  if (next.length === current.length) return false;
  writeBlockedList(next);
  return true;
}

/**
 * React hook that keeps a component's blocked list in sync across surfaces.
 * Re-reads the shared list whenever:
 *  - any surface dispatches {@link BLOCKED_EVENT},
 *  - the `storage` event fires (another tab / external write),
 *  - the window regains focus.
 */
export function subscribeToBlockedListChanges(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => {
    window.dispatchEvent(new Event(BLOCKED_EVENT));
  };
  window.addEventListener("storage", handler);
  window.addEventListener("focus", handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("focus", handler);
  };
}
