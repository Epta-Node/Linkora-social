/**
 * Client for the indexer's notification inbox (issue #1632):
 *
 *   GET  /api/notifications/inbox/:address?limit&cursor   public, cursor-paginated
 *   POST /api/notifications/inbox/read-all                StellarSig-signed
 *
 * Inbox ids are stable (`follow:<follower>`, `like:<post_id>:<liker>`,
 * `tip:<tx_hash>`) and the live WebSocket feed in NotificationsContext builds
 * the same ids, so {@link mergeNotifications} can dedupe pages and live items.
 */

import type { Notification } from "@/contexts/NotificationsContext";
import { signedIndexerFetch } from "@/services/pushNotification";

const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:3001";
export const NOTIFICATIONS_PAGE_SIZE = 20;
const STROOPS_PER_XLM = 10_000_000n;

interface InboxItem {
  id: string;
  type: "follow" | "like" | "tip";
  actor: string;
  post_id: number | null;
  amount: string | null;
  excerpt: string | null;
  created_at: string;
  read: boolean;
}

interface InboxResponse {
  notifications: InboxItem[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface NotificationPage {
  notifications: Notification[];
  hasMore: boolean;
  nextCursor: string | null;
}

/** Formats a base-unit (stroop) amount as XLM without floating-point rounding. */
export function formatStroops(amount: string): string {
  const value = BigInt(amount);
  const whole = value / STROOPS_PER_XLM;
  const fraction = (value % STROOPS_PER_XLM).toString().padStart(7, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function toNotification(item: InboxItem): Notification {
  return {
    id: item.id,
    type: item.type,
    actor: item.actor,
    postId: item.post_id ?? undefined,
    amountXlm: item.amount ? formatStroops(item.amount) : undefined,
    excerpt: item.excerpt ?? undefined,
    timestamp: item.created_at,
    read: item.read,
  };
}

/** Fetches one page of the inbox. Throws on a non-2xx response. */
export async function fetchNotificationPage(
  address: string,
  options: { cursor?: string | null; limit?: number; signal?: AbortSignal } = {}
): Promise<NotificationPage> {
  const params = new URLSearchParams({ limit: String(options.limit ?? NOTIFICATIONS_PAGE_SIZE) });
  if (options.cursor) params.set("cursor", options.cursor);
  const res = await fetch(
    `${INDEXER_URL}/api/notifications/inbox/${encodeURIComponent(address)}?${params}`,
    { signal: options.signal }
  );
  if (!res.ok) throw new Error(`Could not load notifications (HTTP ${res.status})`);
  const body = (await res.json()) as InboxResponse;
  return {
    notifications: body.notifications.map(toNotification),
    hasMore: body.has_more,
    nextCursor: body.next_cursor,
  };
}

/** Moves the caller's read watermark to now. Requires a wallet signature. */
export async function markAllNotificationsRead(address: string): Promise<void> {
  const res = await signedIndexerFetch(address, "/api/notifications/inbox/read-all", {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Could not mark notifications as read (HTTP ${res.status})`);
}

/**
 * Merges notification lists by id, newest first. An item is read when either
 * copy is read, so a page fetched before "mark all as read" cannot resurrect
 * an unread dot.
 */
export function mergeNotifications(...lists: Notification[][]): Notification[] {
  const byId = new Map<string, Notification>();
  for (const list of lists) {
    for (const item of list) {
      const existing = byId.get(item.id);
      byId.set(
        item.id,
        existing ? { ...existing, ...item, read: existing.read || item.read } : item
      );
    }
  }
  return [...byId.values()].sort((a, b) => {
    const diff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    return diff !== 0 ? diff : b.id.localeCompare(a.id);
  });
}
