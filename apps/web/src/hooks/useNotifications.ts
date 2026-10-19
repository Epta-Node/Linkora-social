"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useWalletContext } from "@/components/WalletProvider";
import { useNotificationsContext } from "@/contexts/NotificationsContext";
import type { Notification } from "@/contexts/NotificationsContext";
import {
  fetchNotificationPage,
  markAllNotificationsRead,
  mergeNotifications,
} from "@/lib/notificationsApi";

export type { NotificationType, Notification } from "@/contexts/NotificationsContext";

const LS_NOTIFICATIONS_KEY = "linkora:notifications:items";

function loadStored(address: string): Notification[] {
  try {
    const raw = localStorage.getItem(`${LS_NOTIFICATIONS_KEY}:${address}`);
    if (!raw) return [];
    return JSON.parse(raw) as Notification[];
  } catch {
    return [];
  }
}

function persist(address: string, items: Notification[]): void {
  try {
    localStorage.setItem(`${LS_NOTIFICATIONS_KEY}:${address}`, JSON.stringify(items));
  } catch {
    // Storage full or unavailable: the inbox still works from memory.
  }
}

export type NotificationsStatus = "idle" | "loading" | "loading-more" | "error";

/**
 * Inbox for the connected wallet, backed by the indexer's cursor-paginated
 * notifications API (issue #1632) and merged with live items from
 * NotificationsProvider, which owns the WebSocket and the global unread badge.
 *
 * - Pages are fetched with the opaque `next_cursor`; items are merged by id,
 *   so overlapping pages and items that already arrived live never duplicate.
 * - "Mark all as read" is optimistic: the list and badge update immediately,
 *   and both are rolled back if the signed API call fails.
 * - Reading a single item is tracked locally (no wallet prompt per click).
 */
export function useNotifications() {
  const { address } = useWalletContext();
  const {
    decrementUnread,
    resetUnread,
    incrementUnread,
    notifications: liveNotifications,
  } = useNotificationsContext();

  const [items, setItems] = useState<Notification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<NotificationsStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [markAllPending, setMarkAllPending] = useState(false);
  const [markAllError, setMarkAllError] = useState<string | null>(null);

  const addressRef = useRef<string | null>(null);
  const itemsRef = useRef<Notification[]>([]);
  const inFlight = useRef<AbortController | null>(null);

  const commit = useCallback((next: Notification[]) => {
    itemsRef.current = next;
    setItems(next);
    if (addressRef.current) persist(addressRef.current, next);
  }, []);

  const loadPage = useCallback(
    async (cursor: string | null) => {
      const owner = addressRef.current;
      if (!owner) return;
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setStatus(cursor ? "loading-more" : "loading");
      setError(null);
      try {
        const page = await fetchNotificationPage(owner, { cursor, signal: controller.signal });
        if (controller.signal.aborted || addressRef.current !== owner) return;
        commit(mergeNotifications(itemsRef.current, page.notifications));
        setNextCursor(page.nextCursor);
        setHasMore(page.hasMore);
        setStatus("idle");
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Could not load notifications");
        setStatus("error");
      }
    },
    [commit]
  );

  // Cached items render immediately; the first page then reconciles them.
  useEffect(() => {
    inFlight.current?.abort();
    addressRef.current = address ?? null;
    setNextCursor(null);
    setHasMore(false);
    setMarkAllError(null);
    if (!address) {
      itemsRef.current = [];
      setItems([]);
      setStatus("idle");
      return;
    }
    itemsRef.current = loadStored(address);
    setItems(itemsRef.current);
    void loadPage(null);
    return () => inFlight.current?.abort();
  }, [address, loadPage]);

  // Live items from the provider, deduped by id.
  useEffect(() => {
    if (!addressRef.current || !liveNotifications || liveNotifications.length === 0) return;
    commit(mergeNotifications(itemsRef.current, liveNotifications));
  }, [liveNotifications, commit]);

  const loadMore = useCallback(() => {
    if (!hasMore || !nextCursor || status === "loading" || status === "loading-more") return;
    void loadPage(nextCursor);
  }, [hasMore, nextCursor, status, loadPage]);

  const retry = useCallback(() => {
    void loadPage(nextCursor);
  }, [loadPage, nextCursor]);

  const markAllRead = useCallback(async () => {
    const owner = addressRef.current;
    if (!owner || markAllPending) return;
    const previous = itemsRef.current;
    const unreadIds = new Set(previous.filter((n) => !n.read).map((n) => n.id));

    commit(previous.map((n) => (n.read ? n : { ...n, read: true })));
    resetUnread();
    setMarkAllError(null);
    setMarkAllPending(true);
    try {
      await markAllNotificationsRead(owner);
    } catch (err) {
      if (addressRef.current === owner) {
        // Restore exactly the items that were unread, keeping the badge in step.
        commit(itemsRef.current.map((n) => (unreadIds.has(n.id) ? { ...n, read: false } : n)));
        unreadIds.forEach(() => incrementUnread());
        setMarkAllError(
          err instanceof Error ? err.message : "Could not mark notifications as read"
        );
      }
    } finally {
      setMarkAllPending(false);
    }
  }, [commit, incrementUnread, markAllPending, resetUnread]);

  /**
   * Mark a single notification as read and keep the global unread counter in
   * sync. Unread state is preserved until the user explicitly reads an item
   * (or uses "Mark all read"); it is never cleared just by visiting the page.
   */
  const markRead = useCallback(
    (id: string) => {
      if (!addressRef.current) return;
      const target = itemsRef.current.find((n) => n.id === id);
      if (!target || target.read) return;
      commit(itemsRef.current.map((n) => (n.id === id ? { ...n, read: true } : n)));
      decrementUnread();
    },
    [commit, decrementUnread]
  );

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items]);

  return {
    notifications: items,
    hasMore,
    unreadCount,
    status,
    error,
    markAllPending,
    markAllError,
    markAllRead,
    markRead,
    loadMore,
    retry,
  };
}
