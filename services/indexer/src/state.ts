import type { Pool } from "pg";
import { followCountDriftTotal } from "./metrics";

export type IndexerDomain = "profiles" | "posts" | "follows" | "tips";

export interface DomainCheckpoint {
  domain: IndexerDomain;
  cursor: number;
  updatedAt?: string;
}

export interface DomainCursorStore {
  read(domain: IndexerDomain): Promise<number>;
  write(domain: IndexerDomain, cursor: number): Promise<void>;
}

export function postgresDomainCursorStore(pool: Pool): DomainCursorStore {
  return {
    read: (domain) => readDomainCursor(pool, domain),
    write: (domain, cursor) => writeDomainCursor(pool, domain, cursor),
  };
}

/** Durable per-domain progress used when replicas own different projections. */
export async function readDomainCursor(pool: Pool, domain: IndexerDomain): Promise<number> {
  const result = await pool.query<{ processed_cursor: number | string }>(
    `SELECT processed_cursor FROM indexer_domain_cursor WHERE domain = $1`,
    [domain]
  );
  return Number(result.rows[0]?.processed_cursor ?? 0);
}

export async function writeDomainCursor(
  pool: Pool,
  domain: IndexerDomain,
  cursor: number
): Promise<void> {
  await pool.query(
    `INSERT INTO indexer_domain_cursor (domain, processed_cursor)
     VALUES ($1, $2)
     ON CONFLICT (domain) DO UPDATE
       SET processed_cursor = GREATEST(indexer_domain_cursor.processed_cursor, EXCLUDED.processed_cursor),
           updated_at = NOW()`,
    [domain, cursor]
  );
}

export async function verifyDomainTotals(
  pool: Pool,
  expected: Record<IndexerDomain, number>
): Promise<Record<IndexerDomain, { indexed: number; expected: number; drift: number }>> {
  const tables: Record<IndexerDomain, string> = {
    profiles: "profiles",
    posts: "posts",
    follows: "follows",
    tips: "tips",
  };
  const result = {} as Record<IndexerDomain, { indexed: number; expected: number; drift: number }>;
  for (const domain of Object.keys(expected) as IndexerDomain[]) {
    const row = await pool.query<{ count: number | string }>(
      `SELECT COUNT(*)::int AS count FROM ${tables[domain]}`
    );
    const indexed = Number(row.rows[0]?.count ?? 0);
    result[domain] = { indexed, expected: expected[domain], drift: expected[domain] - indexed };
    if (indexed !== expected[domain]) followCountDriftTotal.inc();
  }
  return result;
}
