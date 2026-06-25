"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LinkoraEventSubscriber,
  LocalStorageCursorStore,
  FollowEvent,
  LikeEvent,
  TipEvent,
} from "linkora-sdk";
import { useWalletContext } from "@/components/WalletProvider";
import { useNotificationsContext } from "@/contexts/NotificationsContext";

export type NotificationType = "follow" | "like" | "tip";

export interface Notification {
  id: string;
  type: NotificationType;
  actor: string;
  postId?: number;
  amountXlm?: string;
  excerpt?: string;
  timestamp: string;
  read: boolean;
}

const LS_NOTIFICATIONS_KEY = "linkora:notifications:items";
const PAGE_SIZE = 10;
const EXCERPT_LEN = 60;
const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";
const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:3001";

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
  localStorage.setItem(`${LS_NOTIFICATIONS_KEY}:${address}`, JSON.stringify(items));
}

function stroopsToXlm(amount: bigint): string {
  return (Number(amount) / 1e7).toFixed(2);
}

async function fetchPostExcerpt(postId: number): Promise<string | undefined> {
  try {
    const res = await fetch(`${INDEXER_URL}/api/posts/${postId}`);
    if (!res.ok) return undefined;
    const post = (await res.json()) as { content?: string };
    if (!post.content) return undefined;
    const text = post.content.trim();
    return text.length > EXCERPT_LEN ? `${text.slice(0, EXCERPT_LEN)}…` : text;
  } catch {
    return undefined;
  }
}

export function useNotifications() {
  const { address } = useWalletContext();
  const { incrementUnread, resetUnread } = useNotificationsContext();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [page, setPage] = useState(1);
  const subscriberRef = useRef<LinkoraEventSubscriber | null>(null);
  const addressRef = useRef<string | null>(null);

  useEffect(() => {
    if (!address) {
      setNotifications([]);
      return;
    }
    setNotifications(loadStored(address));
    addressRef.current = address;
  }, [address]);

  const addNotification = useCallback(
    (n: Notification) => {
      if (!addressRef.current) return;
      setNotifications((prev) => {
        if (prev.some((x) => x.id === n.id)) return prev;
        const next = [n, ...prev].sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        persist(addressRef.current!, next);
        return next;
      });
      incrementUnread();
    },
    [incrementUnread]
  );

  useEffect(() => {
    if (!address || !CONTRACT_ID) return;

    const cursorStore = new LocalStorageCursorStore(`linkora:cursor:notifications:${address}`);

    const subscriber = new LinkoraEventSubscriber({
      rpcUrl: RPC_URL,
      contractId: CONTRACT_ID,
      cursorStore,
      minPollIntervalMs: 5_000,
      maxPollIntervalMs: 30_000,
    });

    subscriberRef.current = subscriber;

    const unsubscribe = subscriber.subscribe({
      follow(event: FollowEvent) {
        if (event.followee !== address) return;
        addNotification({
          id: event.meta.id ?? `follow-${event.follower}-${Date.now()}`,
          type: "follow",
          actor: event.follower,
          timestamp: event.meta.ledgerClosedAt ?? new Date().toISOString(),
          read: false,
        });
      },
      async like(event: LikeEvent) {
        const excerpt = await fetchPostExcerpt(event.post_id);
        addNotification({
          id: event.meta.id ?? `like-${event.user}-${event.post_id}-${Date.now()}`,
          type: "like",
          actor: event.user,
          postId: event.post_id,
          excerpt,
          timestamp: event.meta.ledgerClosedAt ?? new Date().toISOString(),
          read: false,
        });
      },
      async tip(event: TipEvent) {
        const excerpt = await fetchPostExcerpt(event.post_id);
        addNotification({
          id: event.meta.id ?? `tip-${event.tipper}-${event.post_id}-${Date.now()}`,
          type: "tip",
          actor: event.tipper,
          postId: event.post_id,
          amountXlm: stroopsToXlm(event.amount),
          excerpt,
          timestamp: event.meta.ledgerClosedAt ?? new Date().toISOString(),
          read: false,
        });
      },
    });

    subscriber.start();

    return () => {
      unsubscribe();
      subscriber.stop();
      subscriberRef.current = null;
    };
  }, [address, addNotification]);

  const markAllRead = useCallback(() => {
    if (!addressRef.current) return;
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, read: true }));
      persist(addressRef.current!, next);
      return next;
    });
    resetUnread();
  }, [resetUnread]);

  const loadMore = useCallback(() => {
    setPage((p) => p + 1);
  }, []);

  const visibleNotifications = notifications.slice(0, page * PAGE_SIZE);
  const hasMore = notifications.length > page * PAGE_SIZE;
  const unreadCount = notifications.filter((n) => !n.read).length;

  return { notifications: visibleNotifications, hasMore, unreadCount, markAllRead, loadMore };
}
