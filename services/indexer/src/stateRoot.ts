/**
 * Cryptographic state root computation for the Linkora indexer.
 *
 * After processing each ledger's events, the indexer computes a deterministic
 * state_root = sha256(posts_root || follows_root || profiles_root || pools_root)
 * where each sub-root is the root of a sorted Merkle tree over all row hashes
 * in that table.
 *
 * The root is stored in the indexer_state table and exposed via REST.
 */

import { createHash } from "crypto";
import { Pool as PgPool } from "pg";

// ── Merkle helpers ────────────────────────────────────────────────────────────

/** Compute sha256 of a string and return a hex digest. */
function sha256(data: string): string {
  return createHash("sha256")
    .update(String(data ?? ""))
    .digest("hex");
}

/**
 * Build the root of a sorted Merkle tree over an array of leaf hashes.
 * The leaves are sorted before tree construction to ensure determinism
 * regardless of the order rows are returned by the database.
 *
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
      const right = layer[i + 1] ?? left; // duplicate last node for odd count
      next.push(sha256(left + right));
    }
    layer = next;
  }

  return layer[0];
}

// ── Per-table sub-roots ───────────────────────────────────────────────────────

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

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute the combined state root for the current database state.
 * The result is deterministic: the same DB rows always produce the same root.
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
 * Compute and persist the state root for the given ledger sequence.
 * Uses INSERT … ON CONFLICT DO UPDATE so it is idempotent.
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
 * Returns null if no root has been computed for that ledger yet.
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
