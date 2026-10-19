import {
  addOutboxDmMessage,
  confirmPendingPost,
  DmMessage,
  getCachedPostById,
  getCachedPostsByIds,
  getDmSyncCursor,
  getPendingPosts,
  markDmMessageFailed,
  markPendingPostFailed,
  mergeDmDeltas,
  reconcilePosts,
  setDmSyncCursor,
} from "./db";
import { getIndexerBaseUrl } from "./indexerConfig";
import { UnknownRecipientKeyError } from "./dmErrors";
import { Post } from "../components/PostCard";
import { LinkoraClient } from "linkora-sdk";

export { UnknownRecipientKeyError };

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// ── Ledger sequence → Unix seconds ────────────────────────────────────────────

/** Target seconds between Stellar ledger closes. */
const LEDGER_CLOSE_SECONDS = 5;

/** Unix timestamp of Stellar network genesis (2015-09-01T00:00:00Z). */
const STELLAR_GENESIS_UNIX_SECONDS = Math.floor(new Date("2015-09-01T00:00:00Z").getTime() / 1000);

/**
 * Convert a Stellar *ledger sequence number* into seconds since the Unix epoch.
 *
 * A ledger sequence is an ordinal — a mainnet ledger is around 5x10^7 — and
 * must never be written into a column the app treats as a Unix timestamp,
 * which is around 1.8x10^9. Assigning one to the other rendered every post as
 * "20115d ago" and made every cached row look ancient, wiping the offline cache
 * on the first sync (#1543). Mirrors `apps/web/src/lib/analytics.ts`.
 */
export function ledgerToUnixSeconds(ledger: number): number {
  return STELLAR_GENESIS_UNIX_SECONDS + (ledger - 1) * LEDGER_CLOSE_SECONDS;
}

/**
 * The subset of an indexer `/api/posts` row this module consumes, after the
 * ledger field has been renamed to make its unit unambiguous.
 *
 * `createdLedger` is a ledger SEQUENCE, not a timestamp — pass it through
 * {@link ledgerToUnixSeconds} before it reaches anything that stores or renders
 * a `Post.timestamp`.
 */
export interface IndexerPost {
  id: string;
  author: string;
  content: string | null;
  username: string | null;
  tipTotal: number;
  createdLedger: number | null;
  likeCount: number;
  hasLiked: boolean;
}

/** The raw JSON shape returned by the indexer (`created_ledger`, snake_case). */
interface IndexerPostWire {
  id?: unknown;
  author?: unknown;
  content?: unknown;
  username?: unknown;
  tip_total?: unknown;
  created_ledger?: unknown;
  like_count?: unknown;
  has_liked?: unknown;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Type boundary between the indexer's wire format and the app's domain types.
 *
 * This is where `created_ledger` becomes `createdLedger`: renaming it at the
 * boundary is what stops the two units from being confused again, since a
 * ledger sequence assigned to a `Post.timestamp` fails silently (no type error,
 * just a nonsense age and a wiped cache) rather than loudly.
 */
export function normalizeIndexerPost(wire: IndexerPostWire): IndexerPost {
  return {
    id: String(wire.id),
    author: typeof wire.author === "string" ? wire.author : "",
    content: optionalString(wire.content),
    username: optionalString(wire.username),
    tipTotal: optionalNumber(wire.tip_total) ?? 0,
    createdLedger: optionalNumber(wire.created_ledger),
    likeCount: optionalNumber(wire.like_count) ?? 0,
    hasLiked: wire.has_liked === true,
  };
}

/**
 * The post's creation time in seconds since the epoch, converting the indexer's
 * ledger sequence at the boundary. Falls back to "now" when the indexer omitted
 * the ledger, which is strictly better than a value 20000 days in the past.
 */
export function indexerPostTimestamp(post: IndexerPost, nowSeconds: number): number {
  return post.createdLedger !== null ? ledgerToUnixSeconds(post.createdLedger) : nowSeconds;
}

function normalizeIndexerPosts(raw: unknown): IndexerPost[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is IndexerPostWire => typeof row === "object" && row !== null)
    .map(normalizeIndexerPost);
}

/**
 * Maps indexer rows to the app's cached-post shape.
 *
 * Reuses content/username already in SQLite when the indexer omits them, so a
 * refresh never blanks out a post body that was cached earlier.
 */
async function toCachedPosts(indexerPosts: IndexerPost[]): Promise<Post[]> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  // A single batched lookup replaces one `getCachedPostById` call per post.
  const cachedById = await getCachedPostsByIds(indexerPosts.map((ip) => ip.id));

  return indexerPosts.map((ip) => {
    const cached = cachedById.get(ip.id);
    let content = cached?.content;
    let username = cached?.username || "stellar_user";

    if (!content) {
      content = ip.content ?? "Content unavailable offline";
      username = ip.username ?? shortAddress(ip.author);
    }

    return {
      id: ip.id,
      author: ip.author,
      username,
      content,
      tip_total: ip.tipTotal,
      // createdLedger is a sequence number, never a timestamp — convert here.
      timestamp: indexerPostTimestamp(ip, nowSeconds),
      like_count: ip.likeCount,
      has_liked: ip.hasLiked,
    };
  });
}

/**
 * Fetches posts from the indexer and reconciles them with the local SQLite cache.
 * Falls back to placeholder content/username when the indexer doesn't provide them
 * and the post isn't already cached.
 *
 * @param limit Number of posts to fetch
 * @param offset Starting position for pagination
 * @param evictStale Whether to evict synced posts not in the current page (false during pagination)
 */
export async function fetchAndCachePosts(
  limit: number,
  offset: number,
  evictStale: boolean = true
): Promise<Post[]> {
  const indexerUrl = getIndexerBaseUrl();

  // 1. Fetch posts from the indexer
  const res = await fetch(`${indexerUrl}/api/posts?limit=${limit}&offset=${offset}`);
  if (!res.ok) {
    throw new Error("Failed to fetch posts from indexer");
  }

  const data = await res.json();
  const indexerPosts = normalizeIndexerPosts(data.posts);

  // 2. Map to the cached-post shape, reusing local content where possible.
  const finalPosts = await toCachedPosts(indexerPosts);

  // 3. Reconcile with SQLite cache
  await reconcilePosts(finalPosts, evictStale);

  return finalPosts;
}

/** Page size used by the author-scoped query (#1595). */
export const AUTHOR_POSTS_PAGE_SIZE = 10;

/**
 * Fetches a single author's posts directly from the indexer (#1595).
 *
 * The profile screen used to call `useFeed()` and filter the whole loaded feed
 * client-side, which over-fetched every post and hid any of the author's posts
 * that were not inside the current feed page. `evictStale` is always false: an
 * author page must not evict the main feed's cached rows.
 */
export async function fetchAuthorPosts(
  author: string,
  limit: number = AUTHOR_POSTS_PAGE_SIZE,
  offset: number = 0
): Promise<Post[]> {
  if (!author) return [];

  const indexerUrl = getIndexerBaseUrl();
  const res = await fetch(
    `${indexerUrl}/api/posts?author=${encodeURIComponent(author)}&limit=${limit}&offset=${offset}`
  );
  if (!res.ok) {
    throw new Error("Failed to fetch author posts from indexer");
  }

  const data = await res.json();
  const finalPosts = await toCachedPosts(normalizeIndexerPosts(data.posts));

  await reconcilePosts(finalPosts, false);

  return finalPosts;
}

/**
 * Fetches a single post from the indexer by id, bypassing the local cache.
 *
 * The detail screen needs this: a post reached by deep link, notification or
 * share is rarely inside the newest cached page, and a cache-only screen then
 * renders "not found" for a post that plainly exists (#1544). Returns null when
 * the indexer has no such post, and throws on a transport/protocol failure so
 * the caller can distinguish "gone" from "could not ask".
 */
export async function fetchPostById(id: string): Promise<Post | null> {
  const indexerUrl = getIndexerBaseUrl();
  const res = await fetch(`${indexerUrl}/api/posts/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to fetch post ${id} from indexer (status ${res.status})`);
  }

  const data = (await res.json()) as { post?: unknown } | unknown;
  const wire = Array.isArray(data)
    ? (data as unknown[])[0]
    : ((data as { post?: unknown }).post ?? data);
  if (typeof wire !== "object" || wire === null) return null;

  const post = normalizeIndexerPost(wire as IndexerPostWire);
  return {
    id: post.id,
    author: post.author,
    username: post.username ?? shortAddress(post.author),
    content: post.content ?? "Content unavailable offline",
    tip_total: post.tipTotal,
    timestamp: indexerPostTimestamp(post, Math.floor(Date.now() / 1000)),
    like_count: post.likeCount,
    has_liked: post.hasLiked,
    sync_status: "synced",
  };
}

/**
 * Resolves a post for the detail screen: local cache first, then the indexer.
 *
 * A cache hit renders instantly and offline. A cache miss falls back to the
 * network and writes the row back, so the next open is served from SQLite even
 * offline. The fallback is exposed as a standalone function so the screen can
 * bind a retry action to it.
 */
export async function resolvePostWithFallback(id: string): Promise<Post | null> {
  const cached = await getCachedPostById(id);
  if (cached) return cached;

  const fetched = await fetchPostById(id);
  if (!fetched) return null;

  // Persist the fetched row so the next open of this post is served offline.
  // evictStale=false: a single deep-linked post must not evict the feed page.
  try {
    await reconcilePosts([fetched], false);
  } catch (err) {
    console.warn("Failed to cache deep-linked post:", err);
  }
  return fetched;
}

interface WalletKitLike {
  signAndSubmitTransaction(payload: {
    txXdr: string;
    rpcUrl?: string;
  }): Promise<{ hash?: string; txHash?: string }>;
}

export interface SyncPendingPostsOptions {
  walletKit: WalletKitLike;
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  indexerUrl?: string;
}

const NETWORK_PASSPHRASES: Record<string, string> = {
  TESTNET: "Test SDF Network ; September 2015",
  MAINNET: "Public Global Stellar Network ; September 2015",
};

/**
 * Build the options that {@link syncPendingPosts} needs from the active wallet
 * kit, a network preset's contract/RPC endpoints, and the selected network id.
 * Returns null if the wallet kit is not available.
 */
export function getSyncPendingPostsOptions(
  contractId: string,
  rpcUrl: string,
  networkId: string
): SyncPendingPostsOptions | null {
  const walletKit = (globalThis as { __LINKORA_WALLET_KIT__?: WalletKitLike })
    .__LINKORA_WALLET_KIT__;
  if (!walletKit) {
    return null;
  }
  return {
    walletKit,
    contractId,
    rpcUrl,
    networkPassphrase: NETWORK_PASSPHRASES[networkId] ?? NETWORK_PASSPHRASES.TESTNET,
  };
}

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
  const {
    walletKit,
    contractId,
    rpcUrl,
    networkPassphrase,
    indexerUrl = getIndexerBaseUrl(),
  } = options;
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
  /** Whether a verified/published encryption key is known for `otherAddress`. */
  hasPeerKey(otherAddress: string): Promise<boolean>;
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
  // #1561 — check before persisting anything: a key-less recipient must
  // reject with no local message stored, not an optimistic row that later
  // flips to 'failed'.
  if (!(await client.hasPeerKey(recipient))) {
    throw new UnknownRecipientKeyError(recipient);
  }

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
