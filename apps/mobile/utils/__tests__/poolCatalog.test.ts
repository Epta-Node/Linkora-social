/**
 * #1592 — the canonical pool catalog.
 *
 * Pool identity used to live in three places that disagreed: `MOCK_POOLS`
 * (`pool-1/2/3`), `POOL_FIXTURES` and a copy of it inside Explore
 * (`creator-fund`, `music-drops`, `design-guild`). The Pools tab rendered one
 * set of ids and the detail route resolved the other, so every card opened
 * "Pool not found". `utils/poolCatalog` is now the only list, and these tests
 * pin the invariants the navigators rely on.
 */
import {
  POOL_CATALOG,
  POOL_IDS,
  formatPoolBalance,
  getPoolCatalogEntry,
  isKnownPoolId,
  poolAdminsRoute,
  poolDetailRoute,
  searchPoolCatalog,
} from "../poolCatalog";

describe("POOL_CATALOG", () => {
  it("has unique ids", () => {
    expect(new Set(POOL_IDS).size).toBe(POOL_IDS.length);
  });

  it("carries display metadata for every pool", () => {
    for (const entry of POOL_CATALOG) {
      expect(entry.id).toMatch(/^[a-z0-9-]+$/);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.token.length).toBeGreaterThan(0);
      expect(entry.members).toBeGreaterThan(0);
    }
  });

  it("resolves an entry by id and rejects unknown ids", () => {
    expect(getPoolCatalogEntry("creator-fund")?.name).toBe("Creator Fund");
    expect(getPoolCatalogEntry("pool-1")).toBeUndefined();
    expect(isKnownPoolId("music-drops")).toBe(true);
    expect(isKnownPoolId("pool-1")).toBe(false);
  });
});

describe("pool routes (#1592)", () => {
  it("builds the one detail route every navigator uses", () => {
    expect(poolDetailRoute("creator-fund")).toBe("/pools/creator-fund");
    expect(poolDetailRoute("design-guild")).toBe("/pools/design-guild");
  });

  it("nests the admins route under the same pool route", () => {
    expect(poolAdminsRoute("creator-fund")).toBe("/pools/creator-fund/admins");
  });

  it("encodes ids so a route can never escape its segment", () => {
    expect(poolDetailRoute("../../admin")).toBe("/pools/..%2F..%2Fadmin");
  });
});

describe("searchPoolCatalog (#1592)", () => {
  it("matches on id, name, description and token, case-insensitively", () => {
    expect(searchPoolCatalog("CREATOR").map((pool) => pool.id)).toEqual(["creator-fund"]);
    expect(searchPoolCatalog("music").map((pool) => pool.id)).toEqual(["music-drops"]);
    expect(searchPoolCatalog("visual artists").map((pool) => pool.id)).toEqual(["design-guild"]);
    expect(searchPoolCatalog("atlas").map((pool) => pool.id)).toEqual(["design-guild"]);
  });

  it("returns nothing for a blank or unmatched query", () => {
    expect(searchPoolCatalog("")).toEqual([]);
    expect(searchPoolCatalog("")).toEqual([]);
    expect(searchPoolCatalog("zzz-no-such-pool")).toEqual([]);
  });
});

describe("formatPoolBalance (#1592)", () => {
  it("passes an already-formatted balance through untouched", () => {
    expect(formatPoolBalance("18,240 XLM", "XLM")).toBe("18,240 XLM");
  });

  it("formats a raw indexer amount with its token", () => {
    expect(formatPoolBalance("20000", "XLM")).toBe("20,000 XLM");
    expect(formatPoolBalance("0", "XLM")).toBe("0 XLM");
    expect(formatPoolBalance("  7900 NOVA ", "NOVA")).toBe("7,900 NOVA");
  });

  it("returns an unparseable balance unchanged rather than guessing", () => {
    expect(formatPoolBalance("n/a", "XLM")).toBe("n/a");
    expect(formatPoolBalance("", "XLM")).toBe("0 XLM");
  });
});
