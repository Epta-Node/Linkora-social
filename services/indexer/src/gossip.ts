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
 *
 * When divergence is detected, the node automatically replays missed events
 * from the Stellar RPC for the missing ledger range, then unfences and
 * resumes normal operation.
 */

import { Pool as PgPool } from "pg";
import { getStateRoot } from "./stateRoot";
import { backfillStartupGap, type BatchProcessor } from "./stream";

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
 * peer roots diverge, then automatically replay events from the Stellar RPC
 * to bring the node back into sync.
 */
async function reconcile(
  pg: PgPool,
  peerUrl: string,
  divergingLedger: number,
  localRoot: string,
  peerRoot: string,
  rpcUrl: string,
  contractId: string,
  processBatch: BatchProcessor,
  signal: AbortSignal
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

  const firstDivergingLedger = lo;

  console.log(
    JSON.stringify({
      event: "RECONCILIATION_REPLAY_START",
      firstDivergingLedger,
      currentLedger: divergingLedger,
    })
  );

  // Fetch the latest ledger from RPC to determine the replay range.
  try {
    const rpcRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger", params: {} }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!rpcRes.ok) {
      console.error(
        JSON.stringify({
          event: "RECONCILIATION_REPLAY_FAILED",
          reason: "Failed to fetch latest ledger from RPC",
          status: rpcRes.status,
        })
      );
      return;
    }

    const rpcJson = (await rpcRes.json()) as { result?: { sequence: number } };
    const latestLedger = rpcJson.result?.sequence ?? divergingLedger;

    if (latestLedger < firstDivergingLedger) {
      console.log(
        JSON.stringify({
          event: "RECONCILIATION_REPLAY_SKIPPED",
          reason: "RPC latest ledger is before first diverging ledger",
          firstDivergingLedger,
          latestLedger,
        })
      );
      return;
    }

    // Replay events from the first diverging ledger to the latest available.
    await backfillStartupGap(
      {
        rpcUrl,
        contractId,
        maxRetries: 6,
        backoffBaseMs: 250,
        backoffMaxMs: 10_000,
      },
      firstDivergingLedger,
      latestLedger,
      processBatch,
      signal
    );

    // Unfence after successful replay — the node is now in sync.
    fenced = false;

    console.log(
      JSON.stringify({
        event: "RECONCILIATION_REPLAY_COMPLETE",
        firstDivergingLedger,
        latestLedger,
        replayedLedgers: latestLedger - firstDivergingLedger + 1,
      })
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "RECONCILIATION_REPLAY_FAILED",
        reason: err instanceof Error ? err.message : String(err),
        firstDivergingLedger,
      })
    );
  }
}

// ── Gossip loop ───────────────────────────────────────────────────────────────

export interface GossipDeps {
  rpcUrl: string;
  contractId: string;
  processBatch: BatchProcessor;
}

/**
 * Start the gossip loop. Runs until the abort signal fires.
 * Fetches the latest local state root and compares it against each peer.
 * When divergence is detected, automatically replays missed events from the
 * Stellar RPC and unfences the node.
 */
export async function startGossip(
  pg: PgPool,
  signal: AbortSignal,
  deps?: GossipDeps
): Promise<void> {
  if (PEERS.length === 0) {
    console.log("[gossip] No peers configured (INDEXER_PEERS is empty). Gossip disabled.");
    return;
  }

  console.log(`[gossip] Starting gossip with peers: ${PEERS.join(", ")}`);
  if (deps) {
    console.log(`[gossip] Auto-replay enabled (rpcUrl=${deps.rpcUrl})`);
  }

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

        // If deps are provided, attempt automatic replay instead of staying fenced.
        if (deps) {
          await reconcile(
            pg,
            disagreeingPeerUrl,
            localLedger,
            localRoot,
            disagreeingPeerRoot,
            deps.rpcUrl,
            deps.contractId,
            deps.processBatch,
            signal
          );
        } else {
          console.log(
            JSON.stringify({
              event: "RECONCILIATION_REQUIRES_REPLAY",
              firstDivergingLedger: localLedger,
              action: "Manual re-sync required: restart the indexer with REPLAY_FROM_LEDGER=" + localLedger,
            })
          );
        }
        break;
      }

      if (disagreements > 0) {
        if (deps) {
          await reconcile(
            pg,
            disagreeingPeerUrl,
            localLedger,
            localRoot,
            disagreeingPeerRoot,
            deps.rpcUrl,
            deps.contractId,
            deps.processBatch,
            signal
          );
        } else {
          console.log(
            JSON.stringify({
              event: "RECONCILIATION_REQUIRES_REPLAY",
              firstDivergingLedger: localLedger,
              action: "Manual re-sync required: restart the indexer with REPLAY_FROM_LEDGER=" + localLedger,
            })
          );
        }
      }
    } catch (err) {
      console.error("[gossip] Error during gossip cycle:", err);
    }
  }

  console.log("[gossip] Stopped.");
}
