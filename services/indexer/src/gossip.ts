/**
 * Gossip protocol for Byzantine-fault-tolerant divergence detection.
 *
 * Each node periodically broadcasts its latest (ledger, state_root) to a
 * configurable peer list (INDEXER_PEERS env var, comma-separated URLs).
 *
 * On receiving a peer root that differs from the local root at the same ledger,
 * the node emits a DIVERGENCE_DETECTED log and triggers reconciliation.
 *
 * DIVERGENCE_THRESHOLD (default: 2): if >= this many peers agree on a root
 * that differs from the local root, the local node self-fences (stops serving
 * API traffic) and emits a SELF_FENCED alert.
 */

import { Pool as PgPool } from "pg";
import { getStateRoot } from "./stateRoot";

// ── Config ────────────────────────────────────────────────────────────────────

const PEERS: string[] = (process.env["INDEXER_PEERS"] ?? "")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

const DIVERGENCE_THRESHOLD = parseInt(process.env["DIVERGENCE_THRESHOLD"] ?? "2", 10);
const GOSSIP_INTERVAL_MS = parseInt(process.env["GOSSIP_INTERVAL_MS"] ?? "5000", 10);

// ── Self-fencing state ────────────────────────────────────────────────────────

let fenced = false;

/** Returns true if this node has self-fenced due to Byzantine divergence. */
export function isFenced(): boolean {
  return fenced;
}

// ── Peer communication ────────────────────────────────────────────────────────

interface PeerStateRoot {
  ledger: number;
  root: string;
}

async function fetchPeerRoot(peerUrl: string, ledger: number): Promise<PeerStateRoot | null> {
  try {
    const res = await fetch(`${peerUrl}/api/state-root?ledger=${ledger}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return (await res.json()) as PeerStateRoot;
  } catch {
    return null;
  }
}

// ── Reconciliation ────────────────────────────────────────────────────────────

/**
 * Binary-search over [low, high] to find the first ledger where local and
 * peer roots diverge, then log the result for operator action.
 *
 * NOTE: Automatic event replay is not yet implemented (tracked in issue #536).
 * After identifying the first diverging ledger, this function logs
 * RECONCILIATION_REQUIRES_REPLAY so that operators know the node must be
 * manually re-synced from that ledger. The node remains fenced until an
 * operator intervenes.
 */
async function reconcile(
  pg: PgPool,
  peerUrl: string,
  divergingLedger: number,
  localRoot: string,
  peerRoot: string
): Promise<void> {
  console.log(
    JSON.stringify({
      event: "RECONCILIATION_START",
      peer: peerUrl,
      ledger: divergingLedger,
      localRoot,
      peerRoot,
    })
  );

  // Binary search: find earliest diverging ledger.
  const { rows: minRow } = await pg.query<{ min: string }>(
    `SELECT MIN(ledger_sequence) AS min FROM indexer_state`
  );
  const minLedger = minRow[0]?.min ? Number(minRow[0].min) : divergingLedger;

  let lo = minLedger;
  let hi = divergingLedger;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const local = await getStateRoot(pg, mid);
    const peer = await fetchPeerRoot(peerUrl, mid);

    if (!local || !peer || local.root === peer.root) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  // Automatic replay from the diverging ledger is not yet implemented.
  // Log the required action so the operator can trigger a manual re-sync.
  // TODO(#536): implement event replay by re-fetching Soroban events from
  // `firstDivergingLedger` via the RPC stream and re-indexing into PostgreSQL.
  console.log(
    JSON.stringify({
      event: "RECONCILIATION_REQUIRES_REPLAY",
      firstDivergingLedger: lo,
      action: "Manual re-sync required: restart the indexer with REPLAY_FROM_LEDGER=" + lo,
    })
  );
}

// ── Gossip loop ───────────────────────────────────────────────────────────────

/**
 * Start the gossip loop. Runs until the abort signal fires.
 * Fetches the latest local state root and compares it against each peer.
 */
export async function startGossip(pg: PgPool, signal: AbortSignal): Promise<void> {
  if (PEERS.length === 0) {
    console.log("[gossip] No peers configured (INDEXER_PEERS is empty). Gossip disabled.");
    return;
  }

  console.log(`[gossip] Starting gossip with peers: ${PEERS.join(", ")}`);

  while (!signal.aborted) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, GOSSIP_INTERVAL_MS);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    if (signal.aborted || fenced) break;

    try {
      // Get the latest local state root.
      const { rows } = await pg.query<{ ledger_sequence: string; state_root: string }>(
        `SELECT ledger_sequence, state_root
         FROM indexer_state
         ORDER BY ledger_sequence DESC
         LIMIT 1`
      );

      if (rows.length === 0) continue;

      const localLedger = Number(rows[0].ledger_sequence);
      const localRoot = rows[0].state_root;

      let disagreements = 0;
      let disagreeingPeerUrl = "";
      let disagreeingPeerRoot = "";

      for (const peer of PEERS) {
        const peerState = await fetchPeerRoot(peer, localLedger);
        if (!peerState) continue; // peer unreachable — skip

        if (peerState.root !== localRoot) {
          disagreements++;
          disagreeingPeerUrl = peer;
          disagreeingPeerRoot = peerState.root;

          console.log(
            JSON.stringify({
              event: "DIVERGENCE_DETECTED",
              peer,
              ledger: localLedger,
              localRoot,
              peerRoot: peerState.root,
            })
          );
        }
      }

      if (disagreements >= DIVERGENCE_THRESHOLD) {
        fenced = true;
        console.log(
          JSON.stringify({
            event: "SELF_FENCED",
            reason: `${disagreements}/${PEERS.length} peers disagree at ledger ${localLedger}`,
            ledger: localLedger,
            localRoot,
          })
        );
        break;
      }

      if (disagreements > 0) {
        await reconcile(pg, disagreeingPeerUrl, localLedger, localRoot, disagreeingPeerRoot);
      }
    } catch (err) {
      console.error("[gossip] Error during gossip cycle:", err);
    }
  }

  console.log("[gossip] Stopped.");
}
