/**
 * Issue #1358 — Tests for the cursor pagination helpers.
 *
 * `paginateList` / `fetchPageWithCursor` and the LinkoraClient list-method
 * wrappers, with multi-page iteration across several pages.
 */

import { LinkoraClient } from "../client";
import {
  decodeCursor,
  encodeCursor,
  fetchPageWithCursor,
  paginateList,
} from "../pagination";
import { LinkoraError } from "../errors";

// Minimal GeneratedLinkoraClient stub — only the offset list methods used.
jest.mock("../generated/client", () => ({
  GeneratedLinkoraClient: class {
    contractId: string;
    rpcUrl: string;
    networkPassphrase: string;
    constructor(config: any) {
      this.contractId = config.contractId;
      this.rpcUrl = config.rpcUrl;
      this.networkPassphrase = config.networkPassphrase || "Test SDF Network ; September 2015";
    }
  },
}));

describe("cursor pagination (issue #1358)", () => {
  describe("opaque cursors", () => {
    it("encodes and decodes an offset round trip", () => {
      const cursor = encodeCursor(120);
      expect(typeof cursor).toBe("string");
      expect(cursor).not.toContain("5"); // opaque: no raw offset text
      expect(decodeCursor(cursor)).toBe(5);
    });

    it("rejects malformed or tampered cursors with a clear error", () => {
      expect(() => decodeCursor("not-a-cursor!!!")).toThrow(LinkoraError);
      expect(() => decodeCursor(Buffer.from(JSON.stringify({ v: 99, offset: 1 })).toString("base64"))).toThrow(
        LinkoraError
      );
      expect(() => decodeCursor(Buffer.from(JSON.stringify({ v: 1, offset: -3 })).toString("base64"))).toThrow(
        LinkoraError
      );
    });
  });

  describe("fetchPageWithCursor", () => {
    it("returns a next cursor only for full pages", async () => {
      const fetchPage = jest.fn(async (offset: number, limit: number) =>
        offset === 0 ? ["a", "b"] : []
      );

      const first = await fetchPageWithCursor({ pageSize: 2, fetchPage });
      expect(first.items).toEqual(["a", "b"]);
      expect(first.nextCursor).toBeDefined();

      const second = await fetchPageWithCursor({ cursor: first.nextCursor, pageSize: 2, fetchPage });
      expect(second.items).toEqual([]);
      expect(second.nextCursor).toBeUndefined();
    });

    it("rejects an invalid pageSize", async () => {
      await expect(
        fetchPageWithCursor({ pageSize: 0, fetchPage: async () => [] })
      ).rejects.toThrow(/pageSize/);
    });
  });

  describe("paginateList (async generator)", () => {
    it("walks multiple pages transparently", async () => {
      const pages: string[][] = [
        ["a", "b"],
        ["c", "d"],
        ["e"],
      ];
      const fetchPage = jest.fn(async (offset: number, limit: number) => {
        expect(limit).toBe(2);
        return pages[offset / 2];
      });

      const seen: string[] = [];
      for await (const item of paginateList<string>({ pageSize: 2, fetchPage })) {
        seen.push(item);
      }

      expect(seen).toEqual(["a", "b", "c", "d", "e"]);
      expect(fetchPage).toHaveBeenCalledTimes(3); // short page terminates
    });

    it("stops after maxPages", async () => {
      const fetchPage = jest.fn(async () => ["x", "y"]);
      const seen: string[] = [];
      for await (const item of paginateList<string>({ pageSize: 2, maxPages: 2, fetchPage })) {
        seen.push(item);
      }
      expect(seen).toEqual(["x", "x"]);
      expect(fetchPage).toHaveBeenCalledTimes(2);
    });

    it("resumes from a previously returned cursor", async () => {
      const first = await fetchPageWithCursor({
        cursor: undefined,
        pageSize: 2,
        fetchPage: async () => ["a", "b"],
      });

      const seen: string[] = [];
      for await (const item of paginateList<string>({
        cursor: first.nextCursor,
        pageSize: 2,
        fetchPage: async (offset) => (offset === 2 ? ["c"] : []),
      })) {
        seen.push(item);
      }
      expect(seen).toEqual(["c"]);
    });
  });

  describe("LinkoraClient list-method integration", () => {
    let client: LinkoraClient;

    const followerPages: string[][] = [
      ["GF1", "GF2"],
      ["GF3"],
    ];
    const followingPages: string[][] = [["GN1", "GN2", "GN3"]];

    beforeEach(() => {
      jest.clearAllMocks();
      client = new LinkoraClient({ contractId: "CDUMMY", rpcUrl: "https://dummy.example.com" });
      // The offset-backed contract reads behind the pagination helpers.
      (client as unknown as { getFollowers: jest.Mock }).getFollowers = jest.fn(
        async (user: string, offset: number, limit: number) => followerPages[offset / limit] ?? []
      );
      (client as unknown as { getFollowing: jest.Mock }).getFollowing = jest.fn(
        async (user: string, offset: number, limit: number) => followingPages[offset / limit] ?? []
      );
    });

    it("fetchFollowersPage returns items + opaque nextCursor", async () => {
      const page = await client.fetchFollowersPage("GUSER", { pageSize: 2 });
      expect(page.items).toEqual(["GF1", "GF2"]);
      expect(page.nextCursor).toBeDefined();

      const nextPage = await client.fetchFollowersPage("GUSER", {
        cursor: page.nextCursor,
        pageSize: 2,
      });
      expect(nextPage.items).toEqual(["GF3"]);
      expect(nextPage.nextCursor).toBeUndefined();
    });

    it("iterateFollowers walks all pages", async () => {
      const seen: string[] = [];
      for await (const follower of client.iterateFollowers("GUSER", { pageSize: 2 })) {
        seen.push(follower);
      }
      expect(seen).toEqual(["GF1", "GF2", "GF3"]);
    });

    it("iterateFollowing stops at the short page", async () => {
      const seen: string[] = [];
      for await (const followed of client.iterateFollowing("GUSER", { pageSize: 2 })) {
        seen.push(followed);
      }
      expect(seen).toEqual(["GN1", "GN2", "GN3"]);
    });

    it("fetchPostsByAuthorPage paginates post ids", async () => {
      (client as unknown as { getPostsByAuthor: jest.Mock }).getPostsByAuthor = jest.fn(
        async (author: string, offset: number, limit: number) =>
          offset === 0 ? [1n, 2n, 3n] : [4n]
      );

      const page = await client.fetchPostsByAuthorPage("GAUTHOR", { pageSize: 3 });
      expect(page.items).toEqual([1n, 2n, 3n]);
      expect(page.nextCursor).toBeDefined();

      const last = await client.fetchPostsByAuthorPage("GAUTHOR", {
        cursor: page.nextCursor,
        pageSize: 3,
      });
      expect(last.items).toEqual([4n]);
      expect(last.nextCursor).toBeUndefined();
    });
  });
});
