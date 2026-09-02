"use client";

import { useNotificationsContext } from "@/contexts/NotificationsContext";

export type { NotificationType, Notification } from "@/contexts/NotificationsContext";

/**
 * Thin consumer over the canonical NotificationsProvider.
 *
 * All notification state (including the indexer WebSocket feed) now lives in
 * `NotificationsContext`, so this hook lets existing callers keep reading the
 * inbox without owning their own copy of the data.
 */
export function useNotifications() {
  const { address } = useWalletContext();
  const { incrementUnread, decrementUnread, resetUnread } = useNotificationsContext();
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

  /**
   * Mark a single notification as read and keep the global unread counter in
   * sync. Unread state is preserved until the user explicitly reads an item
   * (or uses "Mark all read"); it is never cleared just by visiting the page.
   */
  const markRead = useCallback(
    (id: string) => {
      if (!addressRef.current) return;
      const target = notifications.find((n) => n.id === id);
      if (target?.read) return;

      setNotifications((prev) => {
        const next = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
        persist(addressRef.current!, next);
        return next;
      });
      decrementUnread();
    },
    [decrementUnread, notifications]
  );

  const loadMore = useCallback(() => {
    setPage((p) => p + 1);
  }, []);

  const visibleNotifications = notifications.slice(0, page * PAGE_SIZE);
  const hasMore = notifications.length > page * PAGE_SIZE;
  const unreadCount = notifications.filter((n) => !n.read).length;

  return {
    notifications: visibleNotifications,
    hasMore,
    unreadCount,
    markAllRead,
    markRead,
    loadMore,
  };
}
