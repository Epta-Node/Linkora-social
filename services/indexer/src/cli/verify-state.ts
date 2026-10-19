#!/usr/bin/env ts-node
/**
 * verify-state CLI
 *
 * Re-derives the state root from the current database and compares it against:
 *   a) a trusted root passed as --trusted-root <hex>
 *   b) the root returned by a peer node at --peer <url> for the same ledger
 *
 * Usage:
 *   ts-node src/cli/verify-state.ts --ledger 1234 --trusted-root abc123...
 *   ts-node src/cli/verify-state.ts --ledger 1234 --peer http://indexer-2:3001
 *
 * Exits 0 on match, 1 on mismatch or error.
 */

import { Pool as PgPool } from "pg";
import { computeStateRoot } from "../stateRoot";
import { DOMAIN_EVENT_TOPICS } from "../domain-processor";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key?.startsWith("--") && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      result[key.slice(2)] = argv[++i] ?? "";
    }
  }
  return result;
}

async function fetchPeerRoot(peerUrl: string, ledger: number): Promise<string> {
  const res = await fetch(`${peerUrl}/api/state-root?ledger=${ledger}`);
  if (!res.ok) throw new Error(`Peer responded with ${res.status}`);
  const body = (await res.json()) as { ledger: number; root: string };
  return body.root;
}

type DomainName = keyof typeof DOMAIN_EVENT_TOPICS;

interface DomainTotal {
  domain: DomainName;
  expected: number;
  actual: number;
}

export async function getDomainTotals(
  pg: Pick<PgPool, "query">,
  ledger: number
): Promise<DomainTotal[]> {
  const totals: DomainTotal[] = [];

  for (const [domain, topicConfig] of Object.entries(DOMAIN_EVENT_TOPICS) as [
    DomainName,
    (typeof DOMAIN_EVENT_TOPICS)[DomainName],
  ][]) {
    const expectedSql = `
      SELECT (
        COUNT(*) FILTER (WHERE topic[1] = ANY($2::text[]))
        - COUNT(*) FILTER (WHERE topic[1] = ANY($3::text[]))
      )::int AS count
      FROM raw_events
      WHERE ledger_sequence <= $1
    `;
    const expectedRes = await pg.query(expectedSql, [
      ledger,
      topicConfig.creates,
      topicConfig.deletes,
    ]);
    const actualRes = await pg.query(`SELECT COUNT(*)::int AS count FROM ${domain}`);
    const expectedRow = expectedRes.rows[0] as { count?: number | string } | undefined;
    const actualRow = actualRes.rows[0] as { count?: number | string } | undefined;

    totals.push({
      domain,
      expected: Number(expectedRow?.count ?? 0),
      actual: Number(actualRow?.count ?? 0),
    });
  }

  return totals;
}

export async function verifyDomainTotals(
  pg: Pick<PgPool, "query">,
  ledger: number
): Promise<DomainTotal[]> {
  const totals = await getDomainTotals(pg, ledger);
  return totals.filter((total) => total.expected !== total.actual);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const ledger = args["ledger"] ? parseInt(args["ledger"], 10) : NaN;
  if (isNaN(ledger)) {
    console.error("Usage: verify-state --ledger <N> [--trusted-root <hex> | --peer <url>]");
    process.exit(1);
  }

  const pg = new PgPool({ connectionString: requireEnv("DATABASE_URL") });

  try {
    const domainMismatches = await verifyDomainTotals(pg, ledger);
    if (domainMismatches.length > 0) {
      console.error("Domain table totals do not match raw events:");
      for (const mismatch of domainMismatches) {
        console.error(
          `  ${mismatch.domain}: expected ${mismatch.expected}, found ${mismatch.actual}`
        );
      }
      process.exit(1);
    }

    const localRoot = await computeStateRoot(pg);
    console.log(`Local state root (ledger ${ledger}): ${localRoot}`);

    let trustedRoot: string | undefined;

    if (args["trusted-root"]) {
      trustedRoot = args["trusted-root"];
      console.log(`Trusted root (CLI):                 ${trustedRoot}`);
    } else if (args["peer"]) {
      trustedRoot = await fetchPeerRoot(args["peer"], ledger);
      console.log(`Trusted root (peer ${args["peer"]}): ${trustedRoot}`);
    } else {
      // Just print the local root and exit successfully.
      console.log("No --trusted-root or --peer supplied. Printed local root only.");
      return;
    }

    if (localRoot === trustedRoot) {
      console.log("✓ Roots match — state is consistent.");
    } else {
      console.error("✗ ROOT MISMATCH — local state diverges from trusted root.");
      process.exit(1);
    }
  } finally {
    await pg.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("verify-state error:", err);
    process.exit(1);
  });
}
