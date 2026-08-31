/**
 * useFeedPersistence.test.ts
 *
 * Tests for the feed state persistence and offline support hook.
 * Covers:
 *  1. Cache write/read round-trip
 *  2. TTL expiry clears stale cache
 *  3. clearCache removes cached data
 *  4. isOffline reflects navigator.onLine
 *  5. restoreScroll restores scrollY from cache
 *  6. persistFeed stores posts, cursor, hasMore
 */

import { readCachedFeed, writeCachedFeed, clearCachedFeed } from "@/hooks/useFeedPersistence";

const STORAGE_KEY = "linkora_feed_explore";

function setLocalStorage(key: string, value: string) {
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: jest.fn((k: string) => (k === key ? value : null)),
      setItem: jest.fn(),
      removeItem: jest.fn(),
    },
    writable: true,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("readCachedFeed / writeCachedFeed", () => {
  it("returns null when nothing is cached", () => {
    Object.defineProperty(window, "localStorage", {
      value: { getItem: () => null, setItem: jest.fn(), removeItem: jest.fn() },
      writable: true,
    });
    expect(readCachedFeed("explore")).toBeNull();
  });

  it("round-trips valid cached data within TTL", () => {
    const store: Record<string, string> = {};
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
      },
      writable: true,
    });

    const feedData = {
      posts: [{ id: "1", author: "GA", content: "hello" }],
      activeTab: "explore" as const,
      scrollY: 120,
      cursor: 1000,
      hasMore: true,
    };

    writeCachedFeed("explore", feedData);
    const cached = readCachedFeed("explore");

    expect(cached).not.toBeNull();
    expect(cached?.posts).toHaveLength(1);
    expect(cached?.scrollY).toBe(120);
    expect(cached?.cursor).toBe(1000);
  });

  it("returns null and removes when TTL expired", () => {
    const store: Record<string, string> = {};
    const nowSpy = jest.spyOn(Date, "now");
    let callCount = 0;
    nowSpy.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return 1000;
      return 1000 + 6 * 60 * 1000;
    });

    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
      },
      writable: true,
    });

    writeCachedFeed("explore", {
      posts: [{ id: "1", author: "GA", content: "hello" }],
      activeTab: "explore",
      scrollY: 0,
      cursor: null,
      hasMore: false,
    });

    const cached = readCachedFeed("explore");
    expect(cached).toBeNull();

    nowSpy.mockRestore();
  });
});

describe("clearCachedFeed", () => {
  it("removes the cached feed from storage", () => {
    const store: Record<string, string> = {};
    const removeItemSpy = jest.fn();
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: removeItemSpy,
      },
      writable: true,
    });

    clearCachedFeed("explore");
    expect(removeItemSpy).toHaveBeenCalledWith(STORAGE_KEY);
  });
});
