import type { PostRepository } from "../db/PostRepository";
import { TypedEmitter } from "./emitter";
import type { FeedSyncEvents, IndexerClient } from "./types";

export const DEFAULT_FEED_TYPE = "home";
export const SYNC_PAGE_LIMIT = 50;
/** expo-background-fetch minimum interval, in seconds (15 minutes). */
export const BACKGROUND_SYNC_INTERVAL_SECONDS = 15 * 60;
export const BACKGROUND_SYNC_TASK = "linkora-feed-sync";

export interface FeedSyncOptions {
  feedType?: string;
  limit?: number;
}

/**
 * Coordinates incremental, cursor-based syncing of the feed from the indexer
 * into the local cache.
 *
 * - `syncNow()` fetches posts since the persisted cursor, upserts them and
 *   advances the cursor. Designed to be called on app foreground.
 * - Emits `syncStarted` / `syncCompleted` / `syncFailed` for the Feed screen.
 * - `registerBackgroundSync()` wires it to `expo-background-fetch` for periodic
 *   background syncs every 15 minutes.
 */
export class FeedSyncService {
  readonly events = new TypedEmitter<FeedSyncEvents>();
  private readonly feedType: string;
  private readonly limit: number;
  private running = false;

  constructor(
    private readonly repo: PostRepository,
    private readonly indexer: IndexerClient,
    options: FeedSyncOptions = {}
  ) {
    this.feedType = options.feedType ?? DEFAULT_FEED_TYPE;
    this.limit = options.limit ?? SYNC_PAGE_LIMIT;
  }

  /**
   * Performs one incremental sync. Concurrent calls are coalesced — if a sync
   * is already in flight this resolves to `false` without starting another.
   */
  async syncNow(): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    this.events.emit("syncStarted", undefined);
    try {
      const cursor = await this.repo.getCursor(this.feedType);
      const { posts, nextCursor } = await this.indexer.fetchPostsSince(cursor, this.limit);
      if (posts.length > 0) {
        await this.repo.upsert(posts);
      }
      // Only advance the cursor when the indexer returns one, so an empty
      // response never resets incremental progress to a full re-fetch.
      if (nextCursor !== null) {
        await this.repo.setCursor(this.feedType, nextCursor);
      }
      this.events.emit("syncCompleted", {
        fetched: posts.length,
        cursor: nextCursor ?? cursor,
      });
      return true;
    } catch (err) {
      this.events.emit("syncFailed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    } finally {
      this.running = false;
    }
  }

  /**
   * Registers the periodic background sync via `expo-background-fetch`.
   *
   * The native modules are imported lazily and guarded so that environments
   * without them (web, tests) are a no-op returning `false`.
   */
  async registerBackgroundSync(): Promise<boolean> {
    let BackgroundFetch: typeof import("expo-background-fetch") | null = null;
    let TaskManager: typeof import("expo-task-manager") | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      BackgroundFetch = require("expo-background-fetch");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      TaskManager = require("expo-task-manager");
    } catch {
      return false;
    }
    if (!BackgroundFetch || !TaskManager) return false;

    if (!TaskManager.isTaskDefined(BACKGROUND_SYNC_TASK)) {
      TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
        const ok = await this.syncNow();
        return ok
          ? BackgroundFetch!.BackgroundFetchResult.NewData
          : BackgroundFetch!.BackgroundFetchResult.Failed;
      });
    }

    await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      minimumInterval: BACKGROUND_SYNC_INTERVAL_SECONDS,
      stopOnTerminate: false,
      startOnBoot: true,
    });
    return true;
  }
}
