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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const ledger = args["ledger"] ? parseInt(args["ledger"], 10) : NaN;
  if (isNaN(ledger)) {
    console.error("Usage: verify-state --ledger <N> [--trusted-root <hex> | --peer <url>]");
    process.exit(1);
  }

  const pg = new PgPool({ connectionString: requireEnv("DATABASE_URL") });

  try {
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

main().catch((err) => {
  console.error("verify-state error:", err);
  process.exit(1);
});
