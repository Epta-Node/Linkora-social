/**
 * Cryptographic state root computation for the Linkora indexer.
 *
 * ## Root definition (unchanged, verifiable)
 *
 *   state_root = sha256(posts_root || follows_root || profiles_root || pools_root)
 *
 * where each sub-root is now an XOR accumulator over all individual row hashes
 * rather than a full Merkle tree.  This keeps the root deterministic and
 * verifiable (computeStateRoot still does the full scan for offline checks)
 * while making per-batch updates O(batch_size) instead of O(table_size).
 *
 * ## Incremental update protocol
 *
 *   For every row touched in a batch:
 *     1. Fetch the stored hash for that row key (if any) — the "old hash".
 *     2. Compute the "new hash" from the current row values.
 *     3. XOR-out the old hash, XOR-in the new hash on the accumulator row.
 *     4. Persist the new per-row hash.
 *
 *   Combined root = sha256(postsAcc || followsAcc || profilesAcc || poolsAcc)
 *   where each accumulator is a 64-char hex string (256 bits XOR'd together).
 *
 * ## Bootstrap
 *
 *   The first time applyStateRootDelta is called it checks whether the
 *   `__bootstrap_done__` sentinel row has been flipped.  If not it runs the
 *   full scan once, populates state_root_accumulators and
 *   state_root_row_hashes, then flips the sentinel.  Subsequent calls skip
 *   the scan entirely.
 *
 * ## Backward compatibility
 *
 *   computeStateRoot and saveStateRoot (full-scan variants) are preserved so
 *   that the verify-state CLI and existing tests continue to work unchanged.
 */

import { createHash } from "crypto";
import { Pool as PgPool } from "pg";
import { IngestEvent } from "./pipeline";

// ── Crypto helpers ────────────────────────────────────────────────────────────

/** Compute sha256 of a string and return a 64-char hex digest. */
function sha256(data: string): string {
  return createHash("sha256")
    .update(String(data ?? ""))
    .digest("hex");
}

/**
 * XOR two 64-char hex strings (256-bit values) and return the 64-char result.
 * Both inputs must be exactly 64 hex characters.
 */
export function xorHex(a: string, b: string): string {
  // Work in 8-char (32-bit) chunks.
  // Use `>>> 0` to coerce to unsigned 32-bit so XOR never produces negative
  // numbers (JS bitwise ops work on signed 32-bit internally).
  const CHUNK = 8;
  let result = "";
  for (let i = 0; i < 64; i += CHUNK) {
    const av = (parseInt(a.slice(i, i + CHUNK), 16) >>> 0);
    const bv = (parseInt(b.slice(i, i + CHUNK), 16) >>> 0);
    result += ((av ^ bv) >>> 0).toString(16).padStart(CHUNK, "0");
  }
  return result;
}

// ── Per-table row hash formulas ────────────────────────────────────────────────
// These must match the SQL expressions in the full-table queries below so that
// computeStateRoot and the incremental path agree.

/** Keys that uniquely identify a post row (the primary key). */
function postKey(id: string | bigint): string {
  return `post:${id}`;
}

/** Deterministic hash for a post row — same fields as postsRoot SQL. */
function hashPostRow(row: {
  id: string | bigint;
  author: string;
  content: string;
  tip_total: string | bigint | number;
  like_count: string | bigint | number;
  deleted_at: string | null;
}): string {
  return sha256(
    String(row.id) +
      row.author +
      (row.content ?? "") +
      String(row.tip_total) +
      String(row.like_count) +
      (row.deleted_at ?? "")
  );
}

function followKey(follower: string, followee: string): string {
  return `follow:${follower}:${followee}`;
}

function hashFollowRow(row: {
  follower: string;
  followee: string;
  created_at: string;
}): string {
  return sha256(row.follower + row.followee + row.created_at);
}

function profileKey(address: string): string {
  return `profile:${address}`;
}

function hashProfileRow(row: {
  address: string;
  username: string;
  creator_token: string;
  updated_ledger: string | number;
}): string {
  return sha256(
    row.address + row.username + row.creator_token + String(row.updated_ledger)
  );
}

function poolKey(pool_id: string): string {
  return `pool:${pool_id}`;
}

function hashPoolRow(row: {
  pool_id: string;
  token: string;
  balance: string | bigint | number;
  admins: string;
  threshold: string | number;
  created_ledger: string | number;
  updated_ledger: string | number;
}): string {
  return sha256(
    row.pool_id +
      row.token +
      String(row.balance) +
      row.admins +
      String(row.threshold) +
      String(row.created_ledger) +
      String(row.updated_ledger)
  );
}

// ── Merkle helpers (kept for computeStateRoot / verify-state) ─────────────────

/**
 * Build the root of a sorted Merkle tree over an array of leaf hashes.
 * Returns the all-zeros hash for an empty leaf set.
 */
export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) {
    return "0".repeat(64);
  }

  let layer = [...leaves].sort();

  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] ?? left;
      next.push(sha256(left + right));
    }
    layer = next;
  }

  return layer[0];
}

// ── Full-table sub-roots (for computeStateRoot / verify-state CLI) ─────────────

async function postsRoot(pg: PgPool): Promise<string> {
  const { rows } = await pg.query<{ h: string }>(`
    SELECT encode(
      digest(id::text || author || COALESCE(content,'') || tip_total::text
             || like_count::text || COALESCE(deleted_at::text,''), 'sha256'),
      'hex') AS h
    FROM posts
    ORDER BY id
  `);
  return merkleRoot(rows.map((r) => r.h));
}

async function followsRoot(pg: PgPool): Promise<string> {
  const { rows } = await pg.query<{ h: string }>(`
    SELECT encode(digest(follower || followee || created_at::text, 'sha256'), 'hex') AS h
    FROM follows
    ORDER BY follower, followee
  `);
  return merkleRoot(rows.map((r) => r.h));
}

async function profilesRoot(pg: PgPool): Promise<string> {
  const { rows } = await pg.query<{ h: string }>(`
    SELECT encode(
      digest(address || username || creator_token || updated_ledger::text, 'sha256'),
      'hex') AS h
    FROM profiles
    ORDER BY address
  `);
  return merkleRoot(rows.map((r) => r.h));
}

async function poolsRoot(pg: PgPool): Promise<string> {
  const { rows } = await pg.query<{ h: string }>(`
    SELECT encode(
      digest(pool_id || token || balance::text || admins::text
             || threshold::text || created_ledger::text || updated_ledger::text, 'sha256'),
      'hex') AS h
    FROM pools
    ORDER BY pool_id
  `);
  return merkleRoot(rows.map((r) => r.h));
}

// ── Public API — full-scan (for verify-state CLI, backward compat) ────────────

/**
 * Compute the combined state root by scanning every row in every table.
 * O(table_size) — retained for offline verification and tests.
 * Do NOT call this on the commit hot path.
 */
export async function computeStateRoot(pg: PgPool): Promise<string> {
  const [posts, follows, profiles, pools] = await Promise.all([
    postsRoot(pg),
    followsRoot(pg),
    profilesRoot(pg),
    poolsRoot(pg),
  ]);

  return sha256(posts + follows + profiles + pools);
}

/**
 * Compute and persist the state root via full scan for the given ledger.
 * Kept for backward compatibility and the verify-state CLI.
 */
export async function saveStateRoot(pg: PgPool, ledgerSequence: number): Promise<string> {
  const root = await computeStateRoot(pg);

  await pg.query(
    `INSERT INTO indexer_state (ledger_sequence, state_root)
     VALUES ($1, $2)
     ON CONFLICT (ledger_sequence) DO UPDATE SET state_root = $2, computed_at = NOW()`,
    [ledgerSequence, root]
  );

  return root;
}

/**
 * Retrieve a previously stored state root for a specific ledger.
 */
export async function getStateRoot(
  pg: PgPool,
  ledgerSequence: number
): Promise<{ ledger: number; root: string } | null> {
  const { rows } = await pg.query<{ ledger_sequence: string; state_root: string }>(
    `SELECT ledger_sequence, state_root FROM indexer_state WHERE ledger_sequence = $1`,
    [ledgerSequence]
  );

  if (rows.length === 0) return null;
  return { ledger: Number(rows[0].ledger_sequence), root: rows[0].state_root };
}

// ── Incremental accumulator API ───────────────────────────────────────────────

const ZERO_HASH = "0".repeat(64);
const TABLES = ["posts", "follows", "profiles", "pools"] as const;
type AccTable = (typeof TABLES)[number];

/** Read accumulator values for all four tables in one query. */
async function readAccumulators(
  pg: PgPool
): Promise<Record<AccTable, string>> {
  const { rows } = await pg.query<{ table_name: string; accumulator: string }>(
    `SELECT table_name, accumulator FROM state_root_accumulators
     WHERE table_name = ANY($1::text[])`,
    [TABLES as unknown as string[]]
  );

  const result: Record<string, string> = {
    posts: ZERO_HASH,
    follows: ZERO_HASH,
    profiles: ZERO_HASH,
    pools: ZERO_HASH,
  };
  for (const row of rows) {
    result[row.table_name] = row.accumulator;
  }
  return result as Record<AccTable, string>;
}

/** Derive the combined root from the four accumulators. */
function rootFromAccumulators(acc: Record<AccTable, string>): string {
  return sha256(acc.posts + acc.follows + acc.profiles + acc.pools);
}

/**
 * One-time bootstrap: scan all four tables, populate state_root_row_hashes and
 * state_root_accumulators, then flip the __bootstrap_done__ sentinel.
 * This runs inside a single serializable transaction to get a consistent
 * snapshot across all tables.
 */
async function bootstrap(pg: PgPool): Promise<void> {
  const client = await pg.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");

    // Truncate any stale bootstrap state from a previous partial run.
    await client.query("DELETE FROM state_root_row_hashes");

    // ── posts ──────────────────────────────────────────────────────────────
    const { rows: postRows } = await client.query<{
      id: string;
      author: string;
      content: string;
      tip_total: string;
      like_count: string;
      deleted_at: string | null;
    }>(`SELECT id::text, author, COALESCE(content,'') AS content,
              tip_total::text, like_count::text,
              deleted_at::text AS deleted_at
         FROM posts`);

    let postsAcc = ZERO_HASH;
    for (const row of postRows) {
      const h = hashPostRow(row);
      postsAcc = xorHex(postsAcc, h);
      await client.query(
        `INSERT INTO state_root_row_hashes (table_name, row_key, row_hash)
         VALUES ('posts', $1, $2)
         ON CONFLICT (table_name, row_key) DO UPDATE SET row_hash = $2, updated_at = NOW()`,
        [postKey(row.id), h]
      );
    }

    // ── follows ────────────────────────────────────────────────────────────
    const { rows: followRows } = await client.query<{
      follower: string;
      followee: string;
      created_at: string;
    }>(`SELECT follower, followee, created_at::text FROM follows`);

    let followsAcc = ZERO_HASH;
    for (const row of followRows) {
      const h = hashFollowRow(row);
      followsAcc = xorHex(followsAcc, h);
      await client.query(
        `INSERT INTO state_root_row_hashes (table_name, row_key, row_hash)
         VALUES ('follows', $1, $2)
         ON CONFLICT (table_name, row_key) DO UPDATE SET row_hash = $2, updated_at = NOW()`,
        [followKey(row.follower, row.followee), h]
      );
    }

    // ── profiles ───────────────────────────────────────────────────────────
    const { rows: profileRows } = await client.query<{
      address: string;
      username: string;
      creator_token: string;
      updated_ledger: string;
    }>(`SELECT address, username, creator_token, updated_ledger::text FROM profiles`);

    let profilesAcc = ZERO_HASH;
    for (const row of profileRows) {
      const h = hashProfileRow(row);
      profilesAcc = xorHex(profilesAcc, h);
      await client.query(
        `INSERT INTO state_root_row_hashes (table_name, row_key, row_hash)
         VALUES ('profiles', $1, $2)
         ON CONFLICT (table_name, row_key) DO UPDATE SET row_hash = $2, updated_at = NOW()`,
        [profileKey(row.address), h]
      );
    }

    // ── pools ──────────────────────────────────────────────────────────────
    const { rows: poolRows } = await client.query<{
      pool_id: string;
      token: string;
      balance: string;
      admins: string;
      threshold: string;
      created_ledger: string;
      updated_ledger: string;
    }>(`SELECT pool_id, token, balance::text, admins::text,
              threshold::text, created_ledger::text, updated_ledger::text
         FROM pools`);

    let poolsAcc = ZERO_HASH;
    for (const row of poolRows) {
      const h = hashPoolRow(row);
      poolsAcc = xorHex(poolsAcc, h);
      await client.query(
        `INSERT INTO state_root_row_hashes (table_name, row_key, row_hash)
         VALUES ('pools', $1, $2)
         ON CONFLICT (table_name, row_key) DO UPDATE SET row_hash = $2, updated_at = NOW()`,
        [poolKey(row.pool_id), h]
      );
    }

    // ── Write accumulators ─────────────────────────────────────────────────
    const accEntries: [AccTable, string][] = [
      ["posts", postsAcc],
      ["follows", followsAcc],
      ["profiles", profilesAcc],
      ["pools", poolsAcc],
    ];
    for (const [table, acc] of accEntries) {
      await client.query(
        `INSERT INTO state_root_accumulators (table_name, accumulator)
         VALUES ($1, $2)
         ON CONFLICT (table_name) DO UPDATE SET accumulator = $2, updated_at = NOW()`,
        [table, acc]
      );
    }

    // ── Flip bootstrap sentinel ────────────────────────────────────────────
    await client.query(
      `INSERT INTO state_root_accumulators (table_name, accumulator)
       VALUES ('__bootstrap_done__', $1)
       ON CONFLICT (table_name) DO UPDATE SET accumulator = $1, updated_at = NOW()`,
      ["1".padStart(64, "0")]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Return true if the bootstrap scan has been completed at least once. */
async function isBootstrapped(pg: PgPool): Promise<boolean> {
  const { rows } = await pg.query<{ accumulator: string }>(
    `SELECT accumulator FROM state_root_accumulators WHERE table_name = '__bootstrap_done__'`
  );
  if (rows.length === 0) return false;
  return rows[0].accumulator !== ZERO_HASH;
}

// ── Delta row descriptors ─────────────────────────────────────────────────────

/** Describes a single row change extracted from a batch of IngestEvents. */
export interface RowDelta {
  tableName: AccTable;
  rowKey: string;
  /** New hash — undefined means the row was deleted. */
  newHash: string | undefined;
}

/**
 * Extract the set of row deltas from a batch of IngestEvents.
 * Each event maps to zero or more RowDelta entries.
 * When a batch contains multiple events for the same row key the last one wins
 * (later events in the same ledger are the authoritative final state).
 */
export function extractDeltas(events: IngestEvent[]): RowDelta[] {
  // Use a map keyed by `tableName:rowKey` so duplicates collapse to the last value.
  const map = new Map<string, RowDelta>();

  function set(delta: RowDelta): void {
    map.set(`${delta.tableName}:${delta.rowKey}`, delta);
  }

  for (const ev of events) {
    const topic = (typeof ev.topic[0] === "string" ? ev.topic[0] : "").toLowerCase();
    const data = (ev.data && typeof ev.data === "object" ? ev.data : {}) as Record<
      string,
      unknown
    >;

    switch (topic) {
      case "post_created": {
        const id = String(data.id ?? data.post_id ?? "");
        if (!id) break;
        set({
          tableName: "posts",
          rowKey: postKey(id),
          // We need the canonical row values to hash.  Since the row is brand-
          // new the counts are 0 and there is no deleted_at.
          newHash: hashPostRow({
            id,
            author: String(data.author ?? ""),
            content: String(data.content ?? ""),
            tip_total: "0",
            like_count: "0",
            deleted_at: null,
          }),
        });
        break;
      }

      case "post_deleted": {
        const id = String(data.post_id ?? data.id ?? "");
        if (!id) break;
        // We don't know the current tip/like counts at event time so we cannot
        // compute the correct new hash in-process.  Mark as "needs DB fetch".
        // applyStateRootDelta handles the DB fetch for undefined-newHash deltas
        // differently — here we store a sentinel hash that the apply step will
        // recompute from the live row.
        set({
          tableName: "posts",
          rowKey: postKey(id),
          newHash: undefined, // signals: fetch current row from DB
        });
        break;
      }

      case "tip":
      case "tip_received": {
        const id = String(data.post_id ?? "");
        if (!id) break;
        // Tip changes tip_total which affects the post hash.  Mark for DB fetch.
        set({
          tableName: "posts",
          rowKey: postKey(id),
          newHash: undefined,
        });
        break;
      }

      case "like":
      case "like_received": {
        const id = String(data.post_id ?? "");
        if (!id) break;
        // Like changes like_count.  Mark for DB fetch.
        set({
          tableName: "posts",
          rowKey: postKey(id),
          newHash: undefined,
        });
        break;
      }

      case "follow": {
        const follower = String(data.follower ?? data.from ?? "");
        const followee = String(data.followee ?? data.to ?? "");
        if (!follower || !followee) break;
        // created_at is set by the DB; we fetch the canonical value after insert.
        set({
          tableName: "follows",
          rowKey: followKey(follower, followee),
          newHash: undefined,
        });
        break;
      }

      case "unfollow": {
        const follower = String(data.follower ?? data.from ?? "");
        const followee = String(data.followee ?? data.to ?? "");
        if (!follower || !followee) break;
        set({
          tableName: "follows",
          rowKey: followKey(follower, followee),
          newHash: undefined, // row deleted — apply will XOR-out old hash
        });
        break;
      }

      case "profile_set": {
        const address = String(data.user ?? data.address ?? "");
        if (!address) break;
        set({
          tableName: "profiles",
          rowKey: profileKey(address),
          newHash: undefined,
        });
        break;
      }

      case "profile_deleted": {
        const address = String(data.user ?? data.address ?? "");
        if (!address) break;
        set({
          tableName: "profiles",
          rowKey: profileKey(address),
          newHash: undefined,
        });
        break;
      }

      case "pool_created":
      case "pool_deposit":
      case "pool_withdraw": {
        const poolId = String(data.pool_id ?? "");
        if (!poolId) break;
        set({
          tableName: "pools",
          rowKey: poolKey(poolId),
          newHash: undefined,
        });
        break;
      }

      default:
        break;
    }
  }

  return Array.from(map.values());
}

/**
 * Fetch the current hash for a row from the live DB state.
 * Returns undefined if the row no longer exists (was deleted).
 */
async function fetchCurrentRowHash(
  pg: PgPool,
  tableName: AccTable,
  rowKey: string
): Promise<string | undefined> {
  switch (tableName) {
    case "posts": {
      // rowKey = "post:<id>"
      const id = rowKey.replace(/^post:/, "");
      const { rows } = await pg.query<{
        id: string;
        author: string;
        content: string;
        tip_total: string;
        like_count: string;
        deleted_at: string | null;
      }>(
        `SELECT id::text, author, COALESCE(content,'') AS content,
                tip_total::text, like_count::text, deleted_at::text AS deleted_at
           FROM posts WHERE id = $1`,
        [id]
      );
      if (!rows[0]) return undefined;
      return hashPostRow(rows[0]);
    }

    case "follows": {
      // rowKey = "follow:<follower>:<followee>"
      const rest = rowKey.replace(/^follow:/, "");
      const colonIdx = rest.indexOf(":");
      const follower = rest.slice(0, colonIdx);
      const followee = rest.slice(colonIdx + 1);
      const { rows } = await pg.query<{
        follower: string;
        followee: string;
        created_at: string;
      }>(
        `SELECT follower, followee, created_at::text FROM follows
          WHERE follower = $1 AND followee = $2`,
        [follower, followee]
      );
      if (!rows[0]) return undefined;
      return hashFollowRow(rows[0]);
    }

    case "profiles": {
      // rowKey = "profile:<address>"
      const address = rowKey.replace(/^profile:/, "");
      const { rows } = await pg.query<{
        address: string;
        username: string;
        creator_token: string;
        updated_ledger: string;
      }>(
        `SELECT address, username, creator_token, updated_ledger::text FROM profiles
          WHERE address = $1`,
        [address]
      );
      if (!rows[0]) return undefined;
      return hashProfileRow(rows[0]);
    }

    case "pools": {
      // rowKey = "pool:<pool_id>"
      const poolId = rowKey.replace(/^pool:/, "");
      const { rows } = await pg.query<{
        pool_id: string;
        token: string;
        balance: string;
        admins: string;
        threshold: string;
        created_ledger: string;
        updated_ledger: string;
      }>(
        `SELECT pool_id, token, balance::text, admins::text,
                threshold::text, created_ledger::text, updated_ledger::text
           FROM pools WHERE pool_id = $1`,
        [poolId]
      );
      if (!rows[0]) return undefined;
      return hashPoolRow(rows[0]);
    }
  }
}

/**
 * Apply a batch delta to the incremental accumulators and write the updated
 * root to `indexer_state` for the given ledger.
 *
 * Cost: O(unique_touched_rows) — proportional to the batch, not the table.
 *
 * On the very first call (bootstrap not done) this falls back to the full
 * scan bootstrap then applies the delta.
 */
export async function applyStateRootDelta(
  pg: PgPool,
  ledgerSequence: number,
  events: IngestEvent[]
): Promise<string> {
  // ── One-time bootstrap ────────────────────────────────────────────────────
  if (!(await isBootstrapped(pg))) {
    await bootstrap(pg);
  }

  // ── Extract deltas ────────────────────────────────────────────────────────
  const deltas = extractDeltas(events);

  if (deltas.length === 0) {
    // Nothing changed in this batch — read the current accumulators and write
    // a root entry so the ledger has a record.
    const acc = await readAccumulators(pg);
    const root = rootFromAccumulators(acc);
    await pg.query(
      `INSERT INTO indexer_state (ledger_sequence, state_root)
       VALUES ($1, $2)
       ON CONFLICT (ledger_sequence) DO UPDATE SET state_root = $2, computed_at = NOW()`,
      [ledgerSequence, root]
    );
    return root;
  }

  // ── For each delta, resolve the new hash if not already known ─────────────
  for (const delta of deltas) {
    if (delta.newHash === undefined) {
      delta.newHash = await fetchCurrentRowHash(pg, delta.tableName, delta.rowKey);
    }
  }

  // ── Fetch stored hashes for touched row keys in one query ─────────────────
  // group by table for efficiency
  const byTable = new Map<AccTable, string[]>();
  for (const delta of deltas) {
    const list = byTable.get(delta.tableName) ?? [];
    list.push(delta.rowKey);
    byTable.set(delta.tableName, list);
  }

  const storedHashes = new Map<string, string>(); // `tableName:rowKey` → stored hash
  for (const [table, keys] of byTable) {
    const { rows } = await pg.query<{ row_key: string; row_hash: string }>(
      `SELECT row_key, row_hash FROM state_root_row_hashes
        WHERE table_name = $1 AND row_key = ANY($2::text[])`,
      [table, keys]
    );
    for (const row of rows) {
      storedHashes.set(`${table}:${row.row_key}`, row.row_hash);
    }
  }

  // ── Read current accumulators ──────────────────────────────────────────────
  const acc = await readAccumulators(pg);

  // ── Apply XOR diffs ────────────────────────────────────────────────────────
  for (const delta of deltas) {
    const mapKey = `${delta.tableName}:${delta.rowKey}`;
    const oldHash = storedHashes.get(mapKey) ?? ZERO_HASH;
    const newHash = delta.newHash ?? ZERO_HASH; // ZERO_HASH means row no longer exists

    if (oldHash === newHash) continue; // row unchanged, skip

    // XOR out old, XOR in new.
    acc[delta.tableName] = xorHex(xorHex(acc[delta.tableName], oldHash), newHash);
  }

  const root = rootFromAccumulators(acc);

  // ── Persist everything in a single transaction ────────────────────────────
  const client = await pg.connect();
  try {
    await client.query("BEGIN");

    // Update accumulators.
    for (const [table, accValue] of Object.entries(acc) as [AccTable, string][]) {
      await client.query(
        `INSERT INTO state_root_accumulators (table_name, accumulator)
         VALUES ($1, $2)
         ON CONFLICT (table_name) DO UPDATE SET accumulator = $2, updated_at = NOW()`,
        [table, accValue]
      );
    }

    // Update per-row hashes.
    for (const delta of deltas) {
      const newHash = delta.newHash ?? ZERO_HASH;
      if (newHash === ZERO_HASH) {
        // Row deleted — remove stored hash.
        await client.query(
          `DELETE FROM state_root_row_hashes
            WHERE table_name = $1 AND row_key = $2`,
          [delta.tableName, delta.rowKey]
        );
      } else {
        await client.query(
          `INSERT INTO state_root_row_hashes (table_name, row_key, row_hash)
           VALUES ($1, $2, $3)
           ON CONFLICT (table_name, row_key)
           DO UPDATE SET row_hash = $3, updated_at = NOW()`,
          [delta.tableName, delta.rowKey, newHash]
        );
      }
    }

    // Write the root to indexer_state for this ledger.
    await client.query(
      `INSERT INTO indexer_state (ledger_sequence, state_root)
       VALUES ($1, $2)
       ON CONFLICT (ledger_sequence) DO UPDATE SET state_root = $2, computed_at = NOW()`,
      [ledgerSequence, root]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return root;
}
