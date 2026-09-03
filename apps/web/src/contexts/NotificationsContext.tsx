"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useWalletContext } from "@/components/WalletProvider";

const LS_UNREAD_KEY = "linkora:notifications:unread";
const LS_NOTIFICATIONS_KEY = "linkora:notifications:items";
const PAGE_SIZE = 10;
const EXCERPT_LEN = 60;
const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:3001";
const INDEXER_WS_URL = INDEXER_URL.replace(/^http/, "ws") + "/ws";

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

export interface ActionNotification {
  id: string;
  status: "pending" | "success" | "error";
  message: string;
  txHash?: string;
  createdAt: number;
}

export type NewActionNotification = Omit<ActionNotification, "id" | "createdAt">;
export type ActionNotificationPatch = Partial<Omit<ActionNotification, "id" | "createdAt">>;

interface NotificationsContextValue {
  // Global unread badge (persisted across sessions)
  unreadCount: number;
  incrementUnread: () => void;
  decrementUnread: () => void;
  resetUnread: () => void;

  // Derived count of unread inbox notifications
  inboxUnreadCount: number;

  // Action notifications — stored keyed by id so they are retrievable/updatable
  actionNotifications: ActionNotification[];
  addNotification: (notification: NewActionNotification) => string;
  updateNotification: (id: string, notification: ActionNotificationPatch) => void;
  getNotification: (id: string) => ActionNotification | undefined;

  // Inbox notifications — the persistent, indexer-driven feed
  notifications: Notification[];
  hasMore: boolean;
  markAllRead: () => void;
  loadMore: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue>({
  unreadCount: 0,
  incrementUnread: () => {},
  decrementUnread: () => {},
  resetUnread: () => {},
  inboxUnreadCount: 0,
  actionNotifications: [],
  addNotification: () => "",
  updateNotification: () => {},
  getNotification: () => undefined,
  notifications: [],
  hasMore: false,
  markAllRead: () => {},
  loadMore: () => {},
});

export function useNotificationsContext(): NotificationsContextValue {
  return useContext(NotificationsContext);
}

export function useNotification(): NotificationsContextValue {
  return useNotificationsContext();
}

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

function sortByTimestampDesc(items: Notification[]): Notification[] {
  return [...items].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { address } = useWalletContext();

  // Global unread badge
  const [unreadCount, setUnreadCount] = useState(0);

  // Action notifications keyed by id (from addNotification/updateNotification)
  const [actionNotifications, setActionNotifications] = useState<
    Record<string, ActionNotification>
  >({});

  // Persistent inbox notifications (from indexer WS), owned by this provider
  const [inboxNotifications, setInboxNotifications] = useState<Notification[]>([]);
  const [page, setPage] = useState(1);

  const addressRef = useRef<string | null>(null);
  const idRef = useRef(0);

  // Rehydrate the persisted unread badge
  useEffect(() => {
    const stored = localStorage.getItem(LS_UNREAD_KEY);
    if (stored) setUnreadCount(parseInt(stored, 10) || 0);
  }, []);

  // Load stored inbox items when the wallet address changes
  useEffect(() => {
    if (!address) {
      setInboxNotifications([]);
      addressRef.current = null;
      return;
    }
    setInboxNotifications(loadStored(address));
    addressRef.current = address;
  }, [address]);

  const incrementUnread = useCallback(() => {
    setUnreadCount((prev) => {
      const next = prev + 1;
      localStorage.setItem(LS_UNREAD_KEY, String(next));
      return next;
    });
  }, []);

  const resetUnread = useCallback(() => {
    setUnreadCount(0);
    localStorage.removeItem(LS_UNREAD_KEY);
  }, []);

  const decrementUnread = useCallback(() => {
    setUnreadCount((prev) => {
      const next = Math.max(0, prev - 1);
      localStorage.setItem(LS_UNREAD_KEY, String(next));
      return next;
    });
  }, []);

  const addNotification = useCallback(
    (notification: NewActionNotification) => {
      const id = `notification-${Date.now()}-${idRef.current++}`;
      setActionNotifications((prev) => ({
        ...prev,
        [id]: { ...notification, id, createdAt: Date.now() },
      }));
      if (notification.status !== "pending") incrementUnread();
      return id;
    },
    [incrementUnread]
  );

  const updateNotification = useCallback(
    (id: string, notification: ActionNotificationPatch) => {
      setActionNotifications((prev) => {
        if (!prev[id]) return prev;
        return { ...prev, [id]: { ...prev[id], ...notification } };
      });
      if (notification.status && notification.status !== "pending") incrementUnread();
    },
    [incrementUnread]
  );

  return (
    <NotificationsContext.Provider
      value={{
        unreadCount,
        incrementUnread,
        decrementUnread,
        resetUnread,
        addNotification,
        updateNotification,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );

  // ---- Inbox notifications (persistent, indexer-driven) ----

  const addInboxNotification = useCallback(
    (n: Notification) => {
      if (!addressRef.current) return;
      setInboxNotifications((prev) => {
        if (prev.some((x) => x.id === n.id)) return prev;
        const next = sortByTimestampDesc([n, ...prev]);
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
          addInboxNotification({
            id: eventId,
            type: "follow",
            actor: data.follower,
            timestamp,
            read: false,
          });
        } else if (type === "like" && data.user !== address) {
          const excerpt = await fetchPostExcerpt(data.post_id);
          addInboxNotification({
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
          addInboxNotification({
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
          addInboxNotification({
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
          addInboxNotification({
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
  }, [address, addInboxNotification]);

  const markAllRead = useCallback(() => {
    if (!addressRef.current) return;
    setInboxNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, read: true }));
      persist(addressRef.current!, next);
      return next;
    });
    resetUnread();
  }, [resetUnread]);

  const loadMore = useCallback(() => {
    setPage((p) => p + 1);
  }, []);

  const visibleNotifications = inboxNotifications.slice(0, page * PAGE_SIZE);
  const hasMore = inboxNotifications.length > page * PAGE_SIZE;
  const inboxUnreadCount = inboxNotifications.filter((n) => !n.read).length;

  const value = useMemo(
    () => ({
      unreadCount,
      incrementUnread,
      resetUnread,
      inboxUnreadCount,
      actionNotifications: actionNotificationsList,
      addNotification,
      updateNotification,
      getNotification,
      notifications: visibleNotifications,
      hasMore,
      markAllRead,
      loadMore,
    }),
    [
      unreadCount,
      incrementUnread,
      resetUnread,
      inboxUnreadCount,
      actionNotificationsList,
      addNotification,
      updateNotification,
      getNotification,
      visibleNotifications,
      hasMore,
      markAllRead,
      loadMore,
    ]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
