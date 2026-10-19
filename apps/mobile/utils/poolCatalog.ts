/**
 * #1592 — the single source of truth for pool identity.
 *
 * The app used to keep three unrelated lists of pools: `MOCK_POOLS` in
 * `hooks/usePool.ts` and `hooks/usePools.ts` (`pool-1`, `pool-2`, `pool-3`),
 * `POOL_FIXTURES` in `utils/poolStore.ts` and a copy of the same fixture in
 * `app/(tabs)/explore.tsx` (`creator-fund`, `music-drops`, `design-guild`).
 * The Pools tab rendered ids from one list and `/pool/[id]` resolved them
 * against the other, so *every* pool card opened "Pool not found".
 *
 * Ids now live here, once. The Pools tab, Explore search, the pool store and
 * the detail route all resolve through this module, and every in-app pool link
 * is built by {@link poolDetailRoute} so the two navigable pool routes can
 * never come back.
 *
 * This catalog is *display metadata only* — a name, a description and a token
 * symbol. Balances shown under a live indicator come from the indexer
 * (`refreshPoolFromIndexer`), never from here.
 */

export interface PoolCatalogEntry {
  /** Canonical pool id. This is the value carried in the `/pools/<id>` route. */
  id: string;
  name: string;
  description: string;
  token: string;
  /** Fallback balance for offline rendering. Never presented as live data. */
  balance: string;
  members: number;
}

/**
 * Every pool id the client can render. The indexer is authoritative for pool
 * *state*; this list is authoritative for pool *identity* in the client.
 */
export const POOL_CATALOG: readonly PoolCatalogEntry[] = [
  {
    id: "creator-fund",
    name: "Creator Fund",
    description: "Shared treasury for emerging creators",
    token: "XLM",
    balance: "18,240 XLM",
    members: 128,
  },
  {
    id: "music-drops",
    name: "Music Drops",
    description: "Funding pool for independent releases",
    token: "NOVA",
    balance: "7,900 NOVA",
    members: 64,
  },
  {
    id: "design-guild",
    name: "Design Guild",
    description: "Collective pool for visual artists",
    token: "ATLAS",
    balance: "3,450 ATLAS",
    members: 42,
  },
];

/** Every known pool id, in catalog order. */
export const POOL_IDS: readonly string[] = POOL_CATALOG.map((pool) => pool.id);

export function isKnownPoolId(poolId: string): boolean {
  return POOL_CATALOG.some((pool) => pool.id === poolId);
}

export function getPoolCatalogEntry(poolId: string): PoolCatalogEntry | undefined {
  return POOL_CATALOG.find((pool) => pool.id === poolId);
}

/**
 * The one and only pool detail route.
 *
 * `/pool/[id]` and `/pools/[id]` used to be two screens for one concept, and
 * the one the UI actually pushed could not resolve any real pool. Both
 * navigators and every deep link now build the path here, and the second route
 * no longer exists (#1592).
 */
export function poolDetailRoute(poolId: string): `/pools/${string}` {
  return `/pools/${encodeURIComponent(poolId)}`;
}

/** Admin management for a pool, nested under the single pool route. */
export function poolAdminsRoute(poolId: string): `/pools/${string}/admins` {
  return `/pools/${encodeURIComponent(poolId)}/admins`;
}

function matchesQuery(value: string, query: string): boolean {
  return value.toLowerCase().includes(query);
}

/** Case-insensitive pool search over the canonical catalog. */
export function searchPoolCatalog(query: string): PoolCatalogEntry[] {
  const normalized = query.trim().toLowerCase();

  if (!normalized) return [];

  return POOL_CATALOG.filter((pool) =>
    [pool.id, pool.name, pool.description, pool.token].some((value) =>
      matchesQuery(value, normalized)
    )
  );
}

/**
 * Formats a balance for display. The indexer reports a raw amount
 * (`pool.balance.toString()`), while the catalog carries `"18,240 XLM"`. A
 * value that already names its token is passed through untouched, so this
 * never double-appends a symbol or re-formats a string it does not understand.
 */
export function formatPoolBalance(balance: string, token: string): string {
  const trimmed = balance.trim();

  if (!trimmed) return `0 ${token}`;

  const match = trimmed.match(/^(-?[\d,]+(?:\.\d+)?)\s*([A-Za-z0-9.]*)$/);
  if (!match) return trimmed;

  const [, amount, suffix] = match;
  if (amount === undefined) return trimmed;

  const numeric = Number(amount.replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return trimmed;

  const formatted = numeric.toLocaleString("en-US", { maximumFractionDigits: 7 });
  const symbol = suffix || token;
  return symbol ? `${formatted} ${symbol}` : formatted;
}
