/**
 * E2E Test: Governance Lifecycle
 *
 * Tests the on-chain governance system:
 *   Init governance config → Create proposal → Vote (for & against) →
 *   Execute proposal → Verify parameter changed
 *
 * Governance proposals allow token holders to change protocol parameters
 * through a voting process with configurable quorum, time-lock, and vote windows.
 */

import {
  createTestKeypair,
  submitContractCall,
  waitForIndexedProposal,
  createClient,
  requireEnv,
  scvAddress,
  scvU32,
  scvU64,
  scvBool,
  scvString,
  scvSymbol,
  scvI128,
  sleep,
  retry,
  type TestKeypair,
} from "./setup";
import { nativeToScVal } from "@stellar/stellar-sdk";

describe("E2E: Governance Lifecycle", () => {
  let admin: TestKeypair;
  let voter1: TestKeypair;
  let voter2: TestKeypair;
  let voter3: TestKeypair;
  let client: ReturnType<typeof createClient>;
  let contractId: string;
  let tokenId: string;

  beforeAll(async () => {
    const env = requireEnv();
    contractId = env.contractId;
    tokenId = env.tokenId;
    client = createClient();

    // Create accounts
    admin = await createTestKeypair(process.env.ADMIN_SECRET);
    voter1 = await createTestKeypair(process.env.VOTER1_SECRET);
    voter2 = await createTestKeypair(process.env.VOTER2_SECRET);
    voter3 = await createTestKeypair(process.env.VOTER3_SECRET);

    // Create profiles for all participants
    for (const [user, name] of [
      [admin, "admin_gov"],
      [voter1, "voter1_gov"],
      [voter2, "voter2_gov"],
      [voter3, "voter3_gov"],
    ] as const) {
      const txHash = await submitContractCall(
        "set_profile",
        [scvAddress(user.address), scvString(name), scvAddress(tokenId)],
        user.keypair,
        contractId
      );
      expect(txHash).toBeTruthy();
      await sleep(2000);
    }
  });

  test("1. Initialize governance configuration", async () => {
    // Initialize governance with:
    // - Quorum: 2 votes
    // - Time-lock: 5 ledgers
    // - Vote window: 50 ledgers
    // - Quorum decay: 0 bps (no decay)
    // - Quorum floor: 1
    const txHash = await submitContractCall(
      "gov_init_config",
      [
        scvU32(2),     // quorum
        scvU32(5),     // time_lock_ledgers
        scvU32(50),    // vote_window_ledgers
        scvU32(0),     // quorum_decay_rate_bps
        scvU32(1),     // quorum_floor
      ],
      admin.keypair,
      contractId
    );
    expect(txHash).toBeTruthy();
    console.log(`  Governance initialized: tx=${txHash}`);

    await sleep(3000);

    // Verify governance config on-chain
    const config = await retry(() => client.govGetConfig());
    expect(config).toBeDefined();
    expect(config.quorum).toBe(2);
    expect(config.vote_window_ledgers).toBe(50);
    console.log(`  Gov config: quorum=${config.quorum}, window=${config.vote_window_ledgers}`);
  });

  test("2. Create a governance proposal to change FeeBps", async () => {
    // Propose changing FeeBps from current value to 200 bps (2%)
    const newFeeBps = 200n;

    const txHash = await submitContractCall(
      "gov_propose",
      [
        scvAddress(admin.address),
        scvSymbol("FeeBps"),
        scvU64(newFeeBps),
        nativeToScVal(null), // null address for non-address parameter changes
      ],
      admin.keypair,
      contractId
    );
    expect(txHash).toBeTruthy();
    console.log(`  Proposal created: tx=${txHash}`);

    await sleep(5000);
  });

  test("3. Vote on the proposal (for & against)", async () => {
    // Get the proposal ID (should be 1 as it's the first proposal)
    const proposal = await retry(() => client.govGetProposal(1n));
    expect(proposal).toBeDefined();
    expect(proposal.status).toBe("Active");
    console.log(`  Proposal status: ${proposal.status}`);

    // Voter1 votes FOR
    const vote1Tx = await submitContractCall(
      "gov_vote",
      [
        scvAddress(voter1.address),
        scvU64(1n),  // proposal_id
        scvBool(true),  // support
      ],
      voter1.keypair,
      contractId
    );
    expect(vote1Tx).toBeTruthy();
    console.log(`  Voter1 voted FOR: tx=${vote1Tx}`);

    // Voter2 votes FOR
    const vote2Tx = await submitContractCall(
      "gov_vote",
      [
        scvAddress(voter2.address),
        scvU64(1n),
        scvBool(true),
      ],
      voter2.keypair,
      contractId
    );
    expect(vote2Tx).toBeTruthy();
    console.log(`  Voter2 voted FOR: tx=${vote2Tx}`);

    // Voter3 votes AGAINST
    const vote3Tx = await submitContractCall(
      "gov_vote",
      [
        scvAddress(voter3.address),
        scvU64(1n),
        scvBool(false),
      ],
      voter3.keypair,
      contractId
    );
    expect(vote3Tx).toBeTruthy();
    console.log(`  Voter3 voted AGAINST: tx=${vote3Tx}`);

    await sleep(5000);

    // Verify proposal state after voting
    const updatedProposal = await retry(() => client.govGetProposal(1n));
    console.log(`  Votes FOR: ${updatedProposal.votes_for}, AGAINST: ${updatedProposal.votes_against}`);
    expect(updatedProposal.votes_for).toBeGreaterThanOrEqual(2);
    expect(updatedProposal.votes_against).toBeGreaterThanOrEqual(1);
  });

  test("4. Execute the proposal after time-lock expires", async () => {
    // Wait for time-lock to expire (5 ledgers should pass quickly in local sandbox)
    await sleep(8000);

    // Execute the proposal
    const txHash = await submitContractCall(
      "gov_execute",
      [scvU64(1n)],  // proposal_id
      admin.keypair,
      contractId
    );
    expect(txHash).toBeTruthy();
    console.log(`  Proposal executed: tx=${txHash}`);

    await sleep(5000);

    // Verify proposal is now Executed
    const executedProposal = await retry(() => client.govGetProposal(1n));
    expect(executedProposal.status).toBe("Executed");
    console.log(`  Proposal status after execution: ${executedProposal.status}`);
  });

  test("5. Verify the parameter was changed", async () => {
    // Check that the fee_bps parameter was updated
    const currentFeeBps = await retry(() => client.getFeeBps());
    console.log(`  Current fee_bps: ${currentFeeBps}`);

    // The fee should have been changed to 200 (our proposed value)
    expect(currentFeeBps).toBe(200);
  });

  test("6. Verify proposal indexed by indexer API", async () => {
    // Wait for indexer to pick up the proposal
    const indexedProposal = await waitForIndexedProposal("1");
    expect(indexedProposal).toBeDefined();
    expect(indexedProposal).toHaveProperty("status", "Executed");
    expect(indexedProposal).toHaveProperty("parameter", "FeeBps");
    console.log(`  Indexed proposal: ${JSON.stringify(indexedProposal)}`);
  });
});
