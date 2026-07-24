import {
  confirmPendingPost,
  getCachedPostById,
  getPendingPosts,
  markPendingPostFailed,
  reconcilePosts,
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
