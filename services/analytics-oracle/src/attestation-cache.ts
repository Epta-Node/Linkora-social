/**
 * Bounded LRU cache with per-entry TTL for SignedAttestation objects.
 *
 * Eviction policy (applied in order):
 *   1. TTL  — entries older than `ttlMs` are evicted on the next access or
 *             during a periodic sweep triggered by `purgeExpired()`.
 *   2. LRU  — when the cache is full after TTL cleanup, the least-recently-
 *             used entry is dropped to make room for the new one.
 *   3. Invalidation — `setSignerId()` clears the whole cache when the oracle
 *             signer key rotates, and `beginWindow()` clears it whenever the
 *             analytics report window advances, so a stale signed attestation
 *             that references a closed window or an old key is never served.
 *
 * All operations (get / set / delete) are O(1) thanks to a doubly-linked
 * list threaded through the same node objects stored in the Map.
 *
 * Stats (hits, misses, evictions) are exposed via `getStats()` for the
 * /metrics/cache endpoint.
 */

import { logger } from "./logger.js";

// ── Internal node type ────────────────────────────────────────────────────────

interface Node<V> {
  key: string;
  value: V;
  insertedAt: number; // ms epoch — used for TTL comparison
  prev: Node<V> | null;
  next: Node<V> | null;
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface CacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  /** Total entries evicted (LRU + TTL combined). */
  evictions: number;
  ttlMs: number;
}

export interface AttestationCacheOptions {
  /** Maximum number of entries before LRU eviction kicks in. Default: 10 000. */
  maxSize: number;
  /** Milliseconds before an entry is considered stale. Default: 3 600 000 (1 h). */
  ttlMs: number;
}

// ── Implementation ────────────────────────────────────────────────────────────

export class AttestationCache<V> {
  private readonly map: Map<string, Node<V>> = new Map();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  // Sentinel nodes — head.next is MRU, tail.prev is LRU.
  private readonly head: Node<V>;
  private readonly tail: Node<V>;

  // Identity scoping for whole-cache invalidation.
  /** Fingerprint of the signer key the cached signatures were produced with. */
  private signerId: string | null = null;
  /** "windowStart:windowEnd" key of the report window the cache now covers. */
  private windowKey: string | null = null;

  // Stats counters
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: AttestationCacheOptions) {
    if (options.maxSize < 1) throw new RangeError("maxSize must be >= 1");
    if (options.ttlMs < 0) throw new RangeError("ttlMs must be >= 0");

    this.maxSize = options.maxSize;
    this.ttlMs = options.ttlMs;

    // Initialise sentinel doubly-linked list: head <-> tail
    this.head = {
      key: "__head__",
      value: undefined as unknown as V,
      insertedAt: 0,
      prev: null,
      next: null,
    };
    this.tail = {
      key: "__tail__",
      value: undefined as unknown as V,
      insertedAt: 0,
      prev: null,
      next: null,
    };
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Retrieve an entry.  Returns `undefined` if absent or stale (TTL expired).
   * Promotes a live entry to MRU position.
   */
  get(key: string): V | undefined {
    const node = this.map.get(key);

    if (!node) {
      this.misses++;
      return undefined;
    }

    // TTL check — treat stale entry as a miss and evict it.
    if (this.isExpired(node)) {
      this.evictNode(node, "ttl");
      this.misses++;
      return undefined;
    }

    // Promote to MRU (most-recently-used) position.
    this.moveToFront(node);
    this.hits++;
    return node.value;
  }

  /**
   * Insert or update an entry.
   *
   * On update the entry is refreshed (new value + new TTL) and promoted to MRU.
   * On insert, if the cache is already at capacity the LRU entry is evicted first.
   */
  set(key: string, value: V): void {
    const existing = this.map.get(key);

    if (existing) {
      // Update in-place: refresh value, timestamp, and MRU position.
      existing.value = value;
      existing.insertedAt = Date.now();
      this.moveToFront(existing);
      return;
    }

    // Enforce capacity: evict LRU entry if full.
    if (this.map.size >= this.maxSize) {
      this.evictLru();
    }

    const node: Node<V> = {
      key,
      value,
      insertedAt: Date.now(),
      prev: null,
      next: null,
    };

    this.map.set(key, node);
    this.insertAtFront(node);
  }

  /** Explicitly remove an entry. Returns true if it existed. */
  delete(key: string): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this.removeNode(node);
    this.map.delete(key);
    return true;
  }

  /** Evict all entries whose TTL has expired. Returns the number evicted. */
  purgeExpired(): number {
    let count = 0;
    // Iterate from LRU → MRU; the oldest entries are at the tail end.
    let node = this.tail.prev;
    while (node !== null && node !== this.head) {
      const prev = node.prev; // capture before potential removal
      if (this.isExpired(node)) {
        this.evictNode(node, "ttl");
        count++;
      }
      node = prev;
    }
    return count;
  }

  /**
   * Drop every cached entry, regardless of TTL. Used for whole-cache
   * invalidation — signer rotation and report-window advancement.
   */
  clear(): void {
    if (this.map.size === 0) return;
    this.map.clear();
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  /**
   * Bind the cache to a signer identity (e.g. a fingerprint of the oracle
   * public key). When the identity differs from the previous one the whole
   * cache is invalidated, because cached signatures produced under the old
   * key are no longer verifiable against the current signer.
   *
   * @param signerId  Fingerprint of the current signer key, or null to unset.
   */
  setSignerId(signerId: string | null): void {
    if (signerId === this.signerId) return;
    this.clear();
    this.signerId = signerId;
  }

  /**
   * Announce that the oracle now covers the report window
   * [windowStart, windowEnd]. When the window advances, all cached
   * attestations reference a closed window and are dropped so consumers never
   * receive a stale signature for a report that is no longer current.
   */
  beginWindow(windowStart: bigint, windowEnd: bigint): void {
    const key = `${windowStart}:${windowEnd}`;
    if (key === this.windowKey) return;
    this.clear();
    this.windowKey = key;
  }

  /** Current number of live entries (may include not-yet-purged stale ones). */
  get size(): number {
    return this.map.size;
  }

  /** Snapshot of cache statistics. */
  getStats(): CacheStats {
    return {
      size: this.map.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      ttlMs: this.ttlMs,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private isExpired(node: Node<V>): boolean {
    return this.ttlMs > 0 && Date.now() - node.insertedAt > this.ttlMs;
  }

  /** Remove the LRU entry (the node just before the tail sentinel). */
  private evictLru(): void {
    const lru = this.tail.prev;
    if (!lru || lru === this.head) return; // empty list
    this.evictNode(lru, "lru");
  }

  /** Remove a node from the list + map and increment the eviction counter. */
  private evictNode(node: Node<V>, reason: "lru" | "ttl"): void {
    this.removeNode(node);
    this.map.delete(node.key);
    this.evictions++;
    logger.debug({ key: node.key, reason }, "Attestation cache eviction");
  }

  /** Unlink a node from the doubly-linked list (does NOT remove from map). */
  private removeNode(node: Node<V>): void {
    const p = node.prev!;
    const n = node.next!;
    p.next = n;
    n.prev = p;
    node.prev = null;
    node.next = null;
  }

  /** Insert a node immediately after the head sentinel (MRU position). */
  private insertAtFront(node: Node<V>): void {
    node.prev = this.head;
    node.next = this.head.next;
    this.head.next!.prev = node;
    this.head.next = node;
  }

  /** Move an existing, already-linked node to the MRU position. */
  private moveToFront(node: Node<V>): void {
    this.removeNode(node);
    this.insertAtFront(node);
  }
}
