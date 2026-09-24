/**
 * Cursor pagination helpers (issue #1358).
 *
 * The Linkora contract exposes list reads as offset+limit pages
 * (`get_followers`, `get_following`, `get_posts_by_author`). Hand-rolling
 * cursor loops over raw numeric offsets is error-prone, so this module
 * provides:
 *
 * 1. A **paged response** helper — `fetchPageWithCursor` — that takes one
 *    opaque cursor (or none for the first page) and returns the items plus
 *    the next opaque cursor, or no cursor when the list is exhausted.
 * 2. An **async generator** — `paginateList` — that transparently walks
 *    pages and yields items one by one.
 *
 * Cursors are OPAQUE: an offset is encoded into an unreadable token with a
 * version tag, validated on decode (malformed/tampered cursors are rejected
 * with a clear error) and never exposes raw offsets to callers.
 */

import { LinkoraError } from "./errors.js";

export interface Page<T> {
  items: T[];
  /**
   * Opaque cursor pointing at the next page. Absent when the list is
   * exhausted. Never expose or interpret its internal value.
   */
  nextCursor?: string;
}

export interface PaginationOptions {
  /** Items per page (default 100). */
  pageSize?: number;
  /** Hard cap on the number of pages walked (safety guard, default 100). */
  maxPages?: number;
}

const CURSOR_VERSION = 1;

/** Encode an internal offset into an opaque cursor token. */
export function encodeCursor(offset: number): string {
  return encodeJson({ v: CURSOR_VERSION, offset });
}

/** Decode an opaque cursor token back to the internal offset. */
export function decodeCursor(cursor: string): number {
  let payload: unknown;
  try {
    payload = decodeJson(cursor);
  } catch {
    throw new LinkoraError(
      "Malformed pagination cursor.",
      "INVALID_CURSOR",
      { cursor }
    );
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    (payload as { v?: unknown }).v !== CURSOR_VERSION ||
    typeof (payload as { offset?: unknown }).offset !== "number" ||
    !Number.isInteger((payload as { offset: number }).offset) ||
    (payload as { offset: number }).offset < 0
  ) {
    throw new LinkoraError(
      "Malformed pagination cursor.",
      "INVALID_CURSOR",
      { cursor }
    );
  }

  return (payload as { offset: number }).offset;
}

/** Portability helpers — browsers (btoa/atob) and Node (Buffer) both work. */
function encodeJson(value: unknown): string {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  if (typeof btoa === "function") {
    return btoa(binary);
  }
  // Node fallback.
  return Buffer.from(json, "utf8").toString("base64");
}

function decodeJson(token: string): unknown {
  let binary: string;
  if (typeof atob === "function") {
    binary = atob(token);
  } else {
    binary = Buffer.from(token, "base64").toString("binary");
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Fetch ONE page through the opaque-cursor contract (issue #1358).
 *
 * `fetchPage` receives the decoded offset and page size and returns the
 * items at that window. The next cursor is present when the page came back
 * full (indicating more items may exist) and absent otherwise.
 */
export async function fetchPageWithCursor<T>(opts: {
  /** Opaque cursor from a previous page; omit for the first page. */
  cursor?: string;
  /** Items per page (default 100). */
  pageSize?: number;
  /** Offset+limit page fetcher (one SDK list method). */
  fetchPage: (offset: number, limit: number) => Promise<T[]>;
}): Promise<Page<T>> {
  const pageSize = opts.pageSize ?? 100;
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new LinkoraError("pageSize must be a positive integer.", "INVALID_PAGE_SIZE", {
      pageSize: opts.pageSize,
    });
  }

  const offset = opts.cursor !== undefined ? decodeCursor(opts.cursor) : 0;
  const items = (await opts.fetchPage(offset, pageSize)) ?? [];

  // A short page means the underlying list is exhausted.
  const nextCursor = items.length >= pageSize ? encodeCursor(offset + items.length) : undefined;

  return { items, nextCursor };
}

/**
 * Iterate every item of an offset-paged list behind an opaque cursor
 * (issue #1358).
 *
 * ```ts
 * for await (const follower of paginateList({
 *   pageSize: 100,
 *   fetchPage: (offset, limit) => client.getFollowers(user, offset, limit),
 * })) {
 *   console.log(follower);
 * }
 * ```
 */
export async function* paginateList<T>(
  opts: PaginationOptions & {
    /** Opaque cursor to resume from (omit to start from the beginning). */
    cursor?: string;
    fetchPage: (offset: number, limit: number) => Promise<T[]>;
  }
): AsyncGenerator<T, void, unknown> {
  const maxPages = opts.maxPages ?? 100;
  let cursor: string | undefined = opts.cursor;
  let pages = 0;

  while (true) {
    const page = await fetchPageWithCursor<T>({ cursor, pageSize: opts.pageSize, fetchPage: opts.fetchPage });
    for (const item of page.items) {
      yield item;
    }
    pages++;
    if (page.nextCursor === undefined) return;
    if (maxPages !== undefined && pages >= maxPages) return;
    cursor = page.nextCursor;
  }
}
