import {
  addOutboxDmMessage,
  confirmPendingPost,
  DmMessage,
  getCachedPostsByIds,
  getDmSyncCursor,
  getPendingPosts,
  markDmMessageFailed,
  markPendingPostFailed,
  mergeDmDeltas,
  reconcilePosts,
  setDmSyncCursor,
} from "./db";
import { Post } from "../components/PostCard";
import { LinkoraClient } from "linkora-sdk";

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

  // 2. Fetch content/profile details for each post, using local cache as much as possible.
  // A single batched lookup replaces one `getCachedPostById` call per post.
  const cachedById = await getCachedPostsByIds(indexerPosts.map((ip) => String(ip.id)));

  for (const ip of indexerPosts) {
    const cached = cachedById.get(String(ip.id));
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

interface WalletKitLike {
  signAndSubmitTransaction(payload: { txXdr: string; rpcUrl?: string }): Promise<{ hash?: string; txHash?: string }>;
}

export interface SyncPendingPostsOptions {
  walletKit: WalletKitLike;
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  indexerUrl?: string;
}

const DEFAULT_INDEXER_URL = process.env.EXPO_PUBLIC_INDEXER_URL || "http://localhost:3001";
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

/**
 * Computes exponential backoff delay with jitter.
 * delay = min(base * 2^attempt, max) + random(0, min(base * 2^attempt, max) * jitterFactor)
 */
function computeBackoff(attempt: number): number {
  const exponential = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
  const jitter = exponential * 0.5 * Math.random();
  return Math.floor(exponential + jitter);
}

/**
 * Queries the indexer for a post by author and content.
 * Returns the post ID if found, null otherwise.
 */
async function findPostByAuthorAndContent(
  indexerUrl: string,
  author: string,
  content: string
): Promise<string | null> {
  try {
    // Fetch recent posts by this author (limit 50 to cover recent posts)
    const res = await fetch(
      `${indexerUrl.replace(/\/$/, "")}/api/posts?author=${encodeURIComponent(author)}&limit=50`
    );
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    const posts = data.posts || [];
    
    // Find the post with matching content
    for (const post of posts) {
      if (post.content === content) {
        return String(post.id);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Submits a create_post transaction and waits for the post to be indexed.
 * Returns the real post ID from the indexer.
 */
async function submitAndConfirmPost(
  walletKit: WalletKitLike,
  contractId: string,
  rpcUrl: string,
  networkPassphrase: string,
  indexerUrl: string,
  author: string,
  content: string
): Promise<string> {
  const client = new LinkoraClient({
    contractId,
    rpcUrl,
    networkPassphrase,
  });

  // Build the transaction XDR with proper source account
  const txXdr = await client.prepareCreatePostTx(author, content, rpcUrl);

  // Sign and submit via wallet
  const submitResult = await walletKit.signAndSubmitTransaction({ txXdr, rpcUrl });
  const txHash = submitResult.hash || submitResult.txHash;
  
  if (!txHash) {
    throw new Error("Wallet did not return transaction hash");
  }

  // Poll indexer for the real post ID
  // The indexer processes events asynchronously, so we need to retry
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const postId = await findPostByAuthorAndContent(indexerUrl, author, content);
    if (postId) {
      return postId;
    }
    
    // Wait before next attempt with exponential backoff
    if (attempt < MAX_RETRIES - 1) {
      const delay = computeBackoff(attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error(`Post not indexed after ${MAX_RETRIES} attempts (tx: ${txHash})`);
}

/**
 * Syncs pending/failed optimistic posts by submitting them to the blockchain
 * and confirming with the real post ID from the indexer.
 * Uses exponential backoff for retries and only marks as confirmed
 * when the post is actually indexed.
 */
export async function syncPendingPosts(options: SyncPendingPostsOptions): Promise<void> {
  const { walletKit, contractId, rpcUrl, networkPassphrase, indexerUrl = DEFAULT_INDEXER_URL } = options;
  const pending = await getPendingPosts();
  if (pending.length === 0) return;

  for (const post of pending) {
    try {
      const realId = await submitAndConfirmPost(
        walletKit,
        contractId,
        rpcUrl,
        networkPassphrase,
        indexerUrl,
        post.author,
        post.content
      );
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