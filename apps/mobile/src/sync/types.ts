import type { PostRecord } from "../db/types";

/**
 * Source of fresh posts. Backed by the indexer in production; injected so the
 * sync service can be tested without network access.
 */
export interface IndexerClient {
  /**
   * Returns posts newer than `cursor` (or the first page when `cursor` is
   * `null`), oldest-to-newest, along with the new cursor to persist.
   */
  fetchPostsSince(cursor: string | null, limit: number): Promise<FetchResult>;
}

export interface FetchResult {
  posts: PostRecord[];
  /** The cursor to persist for the next incremental fetch. */
  nextCursor: string | null;
}

/**
 * Submits a post transaction on chain (e.g. via the SDK `TransactionQueue`).
 * Resolves with the contract-assigned post id on confirmation.
 */
export type SubmitPost = (content: string) => Promise<string>;

export interface SyncCompletedPayload {
  fetched: number;
  cursor: string | null;
}

export interface SyncFailedPayload {
  error: string;
}

export type FeedSyncEvents = {
  syncStarted: void;
  syncCompleted: SyncCompletedPayload;
  syncFailed: SyncFailedPayload;
};
