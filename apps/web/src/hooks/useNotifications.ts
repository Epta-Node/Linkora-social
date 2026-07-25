"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWalletContext } from "@/components/WalletProvider";
import { useNotificationsContext } from "@/contexts/NotificationsContext";

export type NotificationType = "follow" | "like" | "tip" | "governance";

export interface Notification {
  id: string;
  type: NotificationType;
  actor: string;
  postId?: number;
  proposalId?: number;
  parameter?: string;
  amountXlm?: string;
  excerpt?: string;
  timestamp: string;
  read: boolean;
}

const LS_NOTIFICATIONS_KEY = "linkora:notifications:items";
const PAGE_SIZE = 10;
const EXCERPT_LEN = 60;
const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:3001";
const INDEXER_WS_URL = INDEXER_URL.replace(/^http/, "ws") + "/ws";

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

function stroopsToXlm(amount: bigint | string | number): string {
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
    if (!address) return;

    const ws = new WebSocket(INDEXER_WS_URL);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          action: "subscribe",
          types: ["follow", "like", "tip", "gov_proposal_created", "gov_proposal_executed"],
        })
      );
    };

    ws.onmessage = async (e) => {
      try {
        const { type, payload } = JSON.parse(e.data);
        if (!payload || !payload.data) return;

        const data = payload.data;
        const timestamp = data.ledgerClosedAt ?? new Date().toISOString();
        const eventId = data.pagingToken ?? `${type}-${Date.now()}`;

        if (type === "follow" && data.followee === address) {
          addNotification({
            id: eventId,
            type: "follow",
            actor: data.follower,
            timestamp,
            read: false,
          });
        } else if (type === "like" && data.user !== address) {
          const excerpt = await fetchPostExcerpt(data.post_id);
          addNotification({
            id: eventId,
            type: "like",
            actor: data.user,
            postId: data.post_id,
            excerpt,
            timestamp,
            read: false,
          });
        } else if (type === "tip" && data.tipper !== address) {
          const excerpt = await fetchPostExcerpt(data.post_id);
          addNotification({
            id: eventId,
            type: "tip",
            actor: data.tipper,
            postId: data.post_id,
            amountXlm: stroopsToXlm(data.amount),
            excerpt,
            timestamp,
            read: false,
          });
        } else if (type === "gov_proposal_created") {
          addNotification({
            id: eventId,
            type: "governance",
            actor: data.proposer ?? "System",
            proposalId: data.proposal_id,
            parameter: data.parameter,
            excerpt: "A new governance proposal was created",
            timestamp,
            read: false,
          });
        } else if (type === "gov_proposal_executed") {
          addNotification({
            id: eventId,
            type: "governance",
            actor: "System",
            proposalId: data.proposal_id,
            parameter: data.parameter,
            excerpt: "A governance proposal was executed",
            timestamp,
            read: false,
          });
        }
      } catch (err) {
        console.error("Failed to process websocket message", err);
      }
    };

    return () => {
      ws.close();
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
