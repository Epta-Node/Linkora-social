import { LinkoraClient } from "../../../../packages/sdk/src/client";

const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || "http://localhost:3001";
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || "CDUMMY";
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-testnet.stellar.org";

export interface PoolData {
  id: string;
  token: string;
  balance: bigint;
  adminCount: number;
  threshold: number;
}

/**
 * Fetch the set of post IDs that a user has liked.
 * Returns a Set for O(1) lookup performance.
 * Throws an error if the indexer is unreachable.
 */
export async function fetchUserLikes(userAddress: string): Promise<Set<string>> {
  const res = await fetch(`${INDEXER_URL}/api/likes/${userAddress}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch likes: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const likes: string[] = data.likes ?? data.post_ids ?? [];
  return new Set(likes.map(String));
}

/**
 * Fetch all pools from the indexer.
 * Throws an error if the indexer is unreachable or returns an error response.
 */
export async function fetchPools(): Promise<PoolData[]> {
  try {
    const res = await fetch(`${INDEXER_URL}/api/pools`);
    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.pools ?? []);
    return list.map((p: any) => ({
      id: p.pool_id ?? p.id,
      token: p.token,
      balance: BigInt(p.balance ?? 0),
      adminCount: Array.isArray(p.admins) ? p.admins.length : (p.admin_count ?? 0),
      threshold: p.threshold ?? 1,
    }));
  } catch {
    return [];
  }
  const data = await res.json();
  const list = Array.isArray(data) ? data : data.pools ?? [];
  return list.map((p: any) => ({
    id: p.pool_id ?? p.id,
    token: p.token,
    balance: BigInt(p.balance ?? 0),
    adminCount: Array.isArray(p.admins) ? p.admins.length : (p.admin_count ?? 0),
    threshold: p.threshold ?? 1,
  }));
}

/**
 * Minimal stale-while-revalidate cache keyed by an arbitrary string.
 *
 * Repeated reads within a cache's TTL return the cached (resolved) value
 * without re-invoking the loader, so dashboard panels avoid redundant RPC
 * calls and redundant loading states on every mount. After the TTL expires the
 * loader is invoked again and the cache is refreshed.
 */
export function createTtlCache<T>(options: {
  /** Loader invoked on a cache miss / after the TTL expiry. */
  load: () => Promise<T>;
  /** How long a cached value stays fresh before re-fetching, in ms. */
  ttlMs: number;
}) {
  let cached: T | undefined;
  let expiresAt = 0;
  let inFlight: Promise<T> | null = null;

  async function get(): Promise<T> {
    const now = Date.now();
    if (cached !== undefined && now < expiresAt) {
      return cached;
    }
    if (inFlight) {
      return inFlight;
    }
    inFlight = (async () => {
      const value = await options.load();
      cached = value;
      expiresAt = Date.now() + options.ttlMs;
      return value;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function invalidate(): void {
    cached = undefined;
    expiresAt = 0;
  }

  return { get, invalidate };
}

const CREATOR_TOKEN_PRICE_TTL_MS = 60_000;

/**
 * Fetch creator-token price/volume data with a module-level TTL cache so the
 * dashboard doesn't issue a fresh RPC call (and show a loading state) on every
 * mount. Repeated reads within the TTL reuse the cached value.
 */
export const fetchCreatorTokenPrice = createTtlCache<{
  price: string | null;
  volume24h: string | null;
  lastFetched: number;
}>({
  ttlMs: CREATOR_TOKEN_PRICE_TTL_MS,
  load: async () => {
    try {
      const res = await fetch(`${INDEXER_URL}/api/creator-tokens/price`);
      if (!res.ok) {
        return { price: null, volume24h: null, lastFetched: Date.now() };
      }
      const data = await res.json();
      return {
        price: data?.price ?? null,
        volume24h: data?.volume_24h ?? data?.volume24h ?? null,
        lastFetched: Date.now(),
      };
    } catch {
      return { price: null, volume24h: null, lastFetched: Date.now() };
    }
  },
});

/** Force the module-level price cache to refetch on the next read. */
export function invalidateCreatorTokenPrice(): void {
  fetchCreatorTokenPrice.invalidate();
}

/**
 * Check whether the contract is currently paused. While paused, write
 * operations (compose/tip/follow) will fail simulation.
 * Fails open (returns false) if the RPC can't be reached, so a transient
 * network error doesn't falsely block the whole app.
 */
export async function fetchIsPaused(): Promise<boolean> {
  try {
    const client = new LinkoraClient({ contractId: CONTRACT_ID, rpcUrl: RPC_URL });
    return await client.isPaused();
  } catch {
    return false;
  }
}

export interface MediaUploadConfig {
  max_upload_bytes: number;
  allowed_image_types: string[];
}

export class MediaUploadError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "MediaUploadError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Fetch the server-reported media upload budget and allowed types.
 *
 * The server is the single source of truth for the byte limit. Rejects falls
 * back to a sensible default rather than throwing so the composer still works
 * when the indexer is unreachable.
 */
export async function fetchUploadConfig(): Promise<MediaUploadConfig> {
  try {
    const res = await fetch(`${INDEXER_URL}/api/posts/media/config`);
    if (!res.ok) {
      return { max_upload_bytes: 20 * 1024 * 1024, allowed_image_types: [] };
    }
    const data = await res.json();
    return {
      max_upload_bytes: Number(data.max_upload_bytes ?? 20 * 1024 * 1024),
      allowed_image_types: Array.isArray(data.allowed_image_types) ? data.allowed_image_types : [],
    };
  } catch {
    return { max_upload_bytes: 20 * 1024 * 1024, allowed_image_types: [] };
  }
}

/**
 * Upload a single media file to the indexer and resolve with its public URL.
 *
 * Surfaces server-side failures (notably 413 Payload Too Large and truncated
 * / partial writes) as typed errors so the composer can display them.
 */
export async function uploadMediaFile(file: File): Promise<{ url: string; size: number }> {
  const form = new FormData();
  form.append("file", file, file.name);

  let res: Response;
  try {
    res = await fetch(`${INDEXER_URL}/api/posts/media`, {
      method: "POST",
      body: form,
    });
  } catch {
    throw new MediaUploadError(
      "Network error while uploading media. Please try again.",
      "NETWORK_ERROR",
      0
    );
  }

  if (res.status === 413) {
    throw new MediaUploadError(
      "Upload is too large for the server and was rejected. Choose a smaller image.",
      "PAYLOAD_TOO_LARGE",
      413
    );
  }

  if (res.status === 415) {
    throw new MediaUploadError(
      "This file type is not supported. Accepted formats: JPG, PNG, WebP.",
      "UNSUPPORTED_MEDIA_TYPE",
      415
    );
  }

  if (!res.ok) {
    let message = "The server could not save this media. Please try again.";
    try {
      const body = await res.json();
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* non-JSON error body — fall back to the generic message */
    }
    throw new MediaUploadError(message, "UPLOAD_FAILED", res.status);
  }

  return res.json();
}
