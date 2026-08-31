import {
  addOutboxDmMessage,
  confirmPendingPost,
  DmMessage,
  getCachedPostById,
  getDmSyncCursor,
  getPendingPosts,
  markDmMessageFailed,
  markPendingPostFailed,
  mergeDmDeltas,
  reconcilePosts,
  setDmSyncCursor,
} from "./db";
import { Post } from "../components/PostCard";

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Fetches posts from the indexer and reconciles them with the local SQLite cache.
 * Falls back to placeholder content/username when the indexer doesn't provide them
 * and the post isn't already cached.
 */
export async function fetchAndCachePosts(limit: number, offset: number): Promise<Post[]> {
  const indexerUrl = process.env.EXPO_PUBLIC_INDEXER_URL || "http://localhost:3001";

  // 1. Fetch posts from the indexer
  const res = await fetch(
    `${indexerUrl.replace(/\/$/, "")}/api/posts?limit=${limit}&offset=${offset}`
  );
  if (!res.ok) {
    throw new Error("Failed to fetch posts from indexer");
  }

  const data = await res.json();
  const indexerPosts = data.posts || [];
  const finalPosts: Post[] = [];

  // 2. Fetch content/profile details for each post, using local cache as much as possible
  for (const ip of indexerPosts) {
    const cached = await getCachedPostById(String(ip.id));
    let content = cached?.content;
    let username = cached?.username || "stellar_user";

    if (!content) {
      content =
        typeof ip.content === "string" && ip.content ? ip.content : "Content unavailable offline";
      username =
        typeof ip.username === "string" && ip.username ? ip.username : shortAddress(ip.author);
    }

    finalPosts.push({
      id: String(ip.id),
      author: ip.author,
      username,
      content,
      tip_total: Number(ip.tip_total || 0),
      timestamp: ip.created_ledger || Math.floor(Date.now() / 1000),
      like_count: Number(ip.like_count || 0),
      has_liked: ip.has_liked || false,
    });
  }

  // 3. Reconcile with SQLite cache
  await reconcilePosts(finalPosts);

  return finalPosts;
}

/**
 * Syncs any pending/failed optimistic posts with a mock confirmation.
 */
export async function syncPendingPosts(): Promise<void> {
  const pending = await getPendingPosts();
  if (pending.length === 0) return;

  for (const post of pending) {
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      const realId = `${Date.now()}`;
      await confirmPendingPost(String(post.id), realId);
    } catch (err) {
      console.error(`Failed to sync optimistic post ${post.id}:`, err);
      // Mark as failed so the UI can display a retry option
      await markPendingPostFailed(String(post.id));
    }
  }
}

/**
 * A minimal source of DM messages, satisfied today by the in-memory mock
 * DmService (`utils/mockDm.ts`) and, once the mobile wallet can produce the
 * raw-message signatures the relay's address-ownership auth requires, by a
 * real dm-relay HTTP client.
 */
export interface DmClient {
  getMessages(otherAddress: string): Promise<DmSourceMessage[]>;
  sendMessage(toAddress: string, content: string): Promise<void>;
}

export interface DmSourceMessage {
  id: string;
  sender: string;
  recipient: string;
  content: string;
  ciphertext_b64?: string;
  timestamp: number;
}

export interface DmReconcileResult {
  mergedCount: number;
  latestSyncedTimestamp: number | null;
}

/**
 * Deterministic, dependency-free content hash (FNV-1a) used to recognize
 * "the same logical message" across devices before the relay has assigned it
 * an id — e.g. an outbox entry composed offline and its later relay-confirmed
 * counterpart. Not a security primitive; only used as a local merge key.
 */
export function computeCiphertextHash(material: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < material.length; i++) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function ciphertextHashOf(msg: DmSourceMessage): string {
  const material =
    msg.ciphertext_b64 && msg.ciphertext_b64.length > 0 ? msg.ciphertext_b64 : msg.content;
  return computeCiphertextHash(material);
}

/**
 * Fetches this conversation's messages from the relay/mock and merges any
 * message newer than the locally stored sync cursor into the local thread,
 * then advances the cursor.
 *
 * The underlying transport (both the current mock and the real dm-relay API)
 * only supports fetching the full/latest message set, not a server-side
 * "since" filter, so the delta is computed here by comparing timestamps
 * against the stored cursor. Merging is still idempotent and duplicate-free
 * regardless of how much the source returns, because `mergeDmDeltas` upserts
 * by message id.
 */
export async function reconcileDmThread(
  client: DmClient,
  conversationId: string,
  otherAddress: string
): Promise<DmReconcileResult> {
  const cursor = await getDmSyncCursor(conversationId);
  const all = await client.getMessages(otherAddress);
  const deltas = all.filter((msg) => msg.timestamp > cursor);

  if (deltas.length === 0) {
    return { mergedCount: 0, latestSyncedTimestamp: null };
  }

  const result = await mergeDmDeltas(
    conversationId,
    deltas.map((msg) => ({
      id: msg.id,
      sender: msg.sender,
      recipient: msg.recipient,
      content: msg.content,
      ciphertextHash: ciphertextHashOf(msg),
      timestamp: msg.timestamp,
    }))
  );

  if (result.newestTimestamp !== null) {
    await setDmSyncCursor(conversationId, result.newestTimestamp);
  }

  return { mergedCount: result.mergedCount, latestSyncedTimestamp: result.newestTimestamp };
}

/**
 * Sends a DM through the outbox: the message is persisted locally as
 * 'pending' before the network call so it renders immediately (including
 * while offline), then marked 'failed' with the relay's error if the send is
 * rejected. On success the row stays 'pending' until the next reconciliation
 * pass dedupes it against the relay-confirmed copy (ciphertext-hash match).
 */
export async function sendDmMessageWithOutbox(
  client: DmClient,
  conversationId: string,
  sender: string,
  recipient: string,
  content: string
): Promise<DmMessage> {
  const outboxMessage = await addOutboxDmMessage(
    conversationId,
    sender,
    recipient,
    content,
    computeCiphertextHash(content)
  );

  try {
    await client.sendMessage(recipient, content);
    return outboxMessage;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await markDmMessageFailed(outboxMessage.id, errorMessage);
    return { ...outboxMessage, syncStatus: "failed", errorMessage };
  }
}
