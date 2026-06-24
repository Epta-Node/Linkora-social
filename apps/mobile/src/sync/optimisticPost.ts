import type { PostRepository } from "../db/PostRepository";
import type { PendingPost } from "../db/types";
import type { SubmitPost } from "./types";

let counter = 0;

/** Generates a collision-resistant local id for an optimistic post. */
export function generateLocalId(): string {
  counter += 1;
  return `local-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/**
 * Creates a post optimistically: it is persisted as `pending` immediately
 * (so the feed can show a "sending…" card) and the on-chain transaction is
 * submitted in the background. On confirmation the post is promoted to the
 * `posts` table; on failure it is marked `failed` for the retry UI.
 *
 * Returns the local id and a promise that resolves once the background submit
 * settles (useful for tests; callers may ignore it).
 */
export async function createOptimisticPost(
  repo: PostRepository,
  submit: SubmitPost,
  author: string,
  content: string
): Promise<{ localId: string; settled: Promise<void> }> {
  const localId = generateLocalId();
  await repo.addPending(localId, content);
  const settled = submitPending(repo, submit, author, localId, content);
  return { localId, settled };
}

/** Re-submits a previously failed pending post. */
export async function retryPendingPost(
  repo: PostRepository,
  submit: SubmitPost,
  author: string,
  localId: string
): Promise<void> {
  const pending = await repo.getPendingById(localId);
  if (!pending) return;
  await submitPending(repo, submit, author, localId, pending.content);
}

async function submitPending(
  repo: PostRepository,
  submit: SubmitPost,
  author: string,
  localId: string,
  content: string
): Promise<void> {
  await repo.markSyncing(localId);
  try {
    const contractId = await submit(content);
    await repo.markSynced(localId, contractId, author);
  } catch (err) {
    await repo.markFailed(localId, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Conflict resolution for posts that were pending while the user was offline.
 *
 * For each pending post, checks whether the indexer already shows it
 * (idempotency by author + content within the 24h conflict window). If so the
 * post is reconciled without re-submitting; otherwise it is left untouched for
 * the normal submit/retry flow.
 *
 * Returns the local ids that were reconciled against an existing post.
 */
export async function reconcilePendingPosts(
  repo: PostRepository,
  author: string,
  pending?: PendingPost[]
): Promise<string[]> {
  const list = pending ?? (await repo.getPending());
  const reconciled: string[] = [];
  for (const post of list) {
    const match = await repo.findConfirmedMatch(author, post);
    if (match) {
      await repo.markSynced(post.local_id, match.id, author);
      reconciled.push(post.local_id);
    }
  }
  return reconciled;
}
