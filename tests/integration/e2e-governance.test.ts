/**
 * E2E Governance Lifecycle Test
 *
 * Uses SDK-based transactions and retry loops:
 *   1. Initialize governance configuration
 *   2. Create a governance proposal (change FeeBps)
 *   3. Vote on the proposal
 *   4. Wait for vote window (via retry loop on proposal status)
 *   5. Execute the proposal
 *   6. Verify parameter change
 *
 * Governance timings use pollContractState to wait for proposal status transitions
 * instead of hardcoded ledger wait times.
 */

import {
  bootstrap,
  teardown,
  submitContractTx,
  createSdkClient,
  pollContractState,
  indexerFetch,
  scvAddress,
  scvU32,
  scvU64,
  scvBool,
  scvSymbol,
  scvVoid,
} from "./setup";

let accounts: Awaited<ReturnType<typeof bootstrap>>["accounts"];
let contracts: Awaited<ReturnType<typeof bootstrap>>["contracts"];
let sdk: ReturnType<typeof createSdkClient>;
let cfgDir: string = "";

beforeAll(async () => {
  const ctx = await bootstrap();
  accounts = ctx.accounts;
  contracts = ctx.contracts;
  sdk = ctx.sdk;
  cfgDir = process.env.E2E_CFG_DIR || "";
}, 300_000);

afterAll(async () => {
  await teardown(cfgDir);
}, 30_000);

function addr(kp: { publicKey(): string }): string {
  return kp.publicKey();
}

describe("Governance E2E", () => {
  test("Governance lifecycle (init → propose → vote → execute → verify)", async () => {
    const cid = contracts.contractId;
    const adminAddr = addr(accounts.admin);

    // ── 1. Initialize governance configuration ─────────────────────────────────
    console.log("\n[governance] 1: Initializing governance config...");
    await submitContractTx(sdk, accounts.admin, "gov_init_config", [
      scvU32(1),   // quorum
      scvU32(2),   // time_lock_ledgers
      scvU32(5),   // vote_window_ledgers
      scvU32(0),   // quorum_decay_rate_bps
      scvU32(1),   // quorum_floor
    ]);
    console.log("  ✓ Governance config initialized");

    // ── 2. Read current fee before proposal ────────────────────────────────────
    const currentFeeBps = await sdk.getFeeBps();
    console.log(`  Current fee BPS: ${currentFeeBps}`);
    const newFeeBps = currentFeeBps + 100;

    // ── 3. Create governance proposal ──────────────────────────────────────────
    console.log("[governance] 2: Creating proposal (FeeBps -> " + newFeeBps + ")...");
    await submitContractTx(sdk, accounts.admin, "gov_propose", [
      scvAddress(adminAddr),
      scvSymbol("FeeBps"),
      scvU64(newFeeBps),
      scvVoid(), // new_address = null (void/None for Option<Address>)
    ]);

    // Read the proposal count to get the new proposal ID
    let proposalId = 1n;
    try {
      const p1 = await sdk.govGetProposal(1n);
      proposalId = p1?.id ?? 1n;
    } catch {
      // Proposal ID is likely 1 for the first proposal
    }
    console.log(`  Proposal ID: ${proposalId}`);

    // ── 4. Verify proposal was created ─────────────────────────────────────────
    console.log("[governance] 3: Verifying proposal state...");
    await pollContractState(
      () => sdk.govGetProposal(proposalId),
      (p) => p.status === "Active" || p.status === "Passed",
      { label: "proposal-created", maxAttempts: 10 }
    );
    console.log("  ✓ Proposal active");

    // ── 5. Vote on the proposal ────────────────────────────────────────────────
    console.log("[governance] 4: Voting...");
    await submitContractTx(sdk, accounts.admin, "gov_vote", [
      scvAddress(adminAddr), scvU64(proposalId), scvBool(true),
    ]);
    console.log("  ✓ Admin voted FOR");

    // ── 6. Wait for vote window to close (retry loop, not fixed sleep) ─────────
    console.log("[governance] 5: Waiting for vote window to close...");
    const executed = await pollContractState(
      () =>
        sdk.govGetProposal(proposalId).then((p) => ({
          status: p.status,
          votes_for: p.votes_for,
          votes_against: p.votes_against,
        })),
      (state) => {
        console.log(`    Proposal status: ${state.status}, for: ${state.votes_for}`);
        return state.status === "Passed" || state.status === "Executed";
      },
      { label: "proposal-passed", maxAttempts: 60, baseDelayMs: 2000 }
    );
    console.log(`  ✓ Proposal status: ${executed.status}`);

    // ── 7. Execute the proposal ────────────────────────────────────────────────
    if (executed.status !== "Executed") {
      console.log("[governance] 6: Executing proposal...");
      await submitContractTx(sdk, accounts.admin, "gov_execute", [scvU64(proposalId)]);
      console.log("  ✓ Proposal executed");
    } else {
      console.log("[governance] 6: Already executed");
    }

    // ── 8. Verify parameter was changed ────────────────────────────────────────
    console.log("[governance] 7: Verifying parameter change...");
    await pollContractState(
      () => sdk.getFeeBps(),
      (fee) => fee !== currentFeeBps,
      { label: "fee-changed", maxAttempts: 10 }
    );
    const feeBpsAfter = await sdk.getFeeBps();
    console.log(`  Fee BPS: ${currentFeeBps} → ${feeBpsAfter}`);
    console.log("  ✓ Governance parameter changed");

    // ── 9. Check indexer governance data ───────────────────────────────────────
    console.log("[governance] 8: Checking indexer governance state...");
    try {
      const proposalsResp = await indexerFetch("/api/governance/proposals?limit=10");
      if (proposalsResp.ok && proposalsResp.data) {
        console.log("  ✓ Indexer has governance data");
      }
    } catch {
      console.log("  (governance API check skipped)");
    }
  }, 300_000);
});
