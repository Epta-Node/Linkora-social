/**
 * E2E Social Graph Test
 *
 * Uses SDK-based transactions and retry loops for deterministic verification:
 *   1. Create 3 user profiles
 *   2. Follow chain (Alice→Bob, Bob→Charlie)
 *   3. Verify follower counts
 *   4. Block user (Alice blocks Charlie)
 *   5. Verify block
 *   6. Unblock (Alice unblocks Charlie)
 *   7. Verify restore
 */

import {
  bootstrap,
  teardown,
  submitContractTx,
  pollForProfile,
  pollContractState,
  indexerFetch,
  createSdkClient,
  scvAddress,
  scvString,
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

describe("Social Graph E2E", () => {
  test("Social graph with 3 users (follow chain, block, unblock, restore)", async () => {
    const cid = contracts.contractId;
    const tid = contracts.tokenId;
    const aliceAddr = addr(accounts.alice);
    const bobAddr = addr(accounts.bob);
    const charlieAddr = addr(accounts.charlie);

    // ── 1. Create profiles ──────────────────────────────────────────────────
    console.log("\n[social] 1: Creating profiles...");
    await submitContractTx(sdk, accounts.alice, "set_profile", [
      scvAddress(aliceAddr), scvString("alice_social"), scvAddress(tid),
    ]);
    await submitContractTx(sdk, accounts.bob, "set_profile", [
      scvAddress(bobAddr), scvString("bob_social"), scvAddress(tid),
    ]);
    await submitContractTx(sdk, accounts.charlie, "set_profile", [
      scvAddress(charlieAddr), scvString("charlie_social"), scvAddress(tid),
    ]);

    await pollForProfile(aliceAddr);
    await pollForProfile(bobAddr);
    await pollForProfile(charlieAddr);
    console.log("  ✓ All 3 profiles confirmed");

    // ── 2. Create follow chain: Alice→Bob, Bob→Charlie ──────────────────────
    console.log("[social] 2: Creating follow chain...");
    await submitContractTx(sdk, accounts.alice, "follow", [
      scvAddress(aliceAddr), scvAddress(bobAddr),
    ]);
    await submitContractTx(sdk, accounts.bob, "follow", [
      scvAddress(bobAddr), scvAddress(charlieAddr),
    ]);

    await pollContractState(
      () => sdk.getFollowing(aliceAddr, 0, 10),
      (list) => list.includes(bobAddr),
      { label: "alice-follows-bob", maxAttempts: 20 }
    );
    await pollContractState(
      () => sdk.getFollowing(bobAddr, 0, 10),
      (list) => list.includes(charlieAddr),
      { label: "bob-follows-charlie", maxAttempts: 20 }
    );
    console.log("  ✓ Follow chain confirmed on-chain");

    // ── 3. Verify follower counts via indexer ───────────────────────────────
    console.log("[social] 3: Verifying follower counts via indexer...");
    await pollContractState(
      () => indexerFetch<{ total: number }>(`/api/follows/${bobAddr}/followers?limit=10`),
      (resp) => (resp.data?.total ?? 0) >= 1,
      { label: "bob-followers-indexer", maxAttempts: 20 }
    );
    console.log("  ✓ Bob has at least 1 follower");

    await pollContractState(
      () => indexerFetch<{ total: number }>(`/api/follows/${charlieAddr}/followers?limit=10`),
      (resp) => (resp.data?.total ?? 0) >= 1,
      { label: "charlie-followers-indexer", maxAttempts: 20 }
    );
    console.log("  ✓ Charlie has at least 1 follower");

    // ── 4. Block: Alice blocks Charlie ──────────────────────────────────────
    console.log("[social] 4: Alice blocks Charlie...");
    await submitContractTx(sdk, accounts.alice, "block_user", [
      scvAddress(aliceAddr), scvAddress(charlieAddr),
    ]);

    await pollContractState(
      () => sdk.isBlocked(aliceAddr, charlieAddr),
      (blocked) => blocked === true,
      { label: "block-confirmed", maxAttempts: 20 }
    );
    console.log("  ✓ Block confirmed");

    // ── 5. Unblock: Alice unblocks Charlie ───────────────────────────────────
    console.log("[social] 5: Alice unblocks Charlie...");
    await submitContractTx(sdk, accounts.alice, "unblock_user", [
      scvAddress(aliceAddr), scvAddress(charlieAddr),
    ]);

    await pollContractState(
      () => sdk.isBlocked(aliceAddr, charlieAddr),
      (blocked) => blocked === false,
      { label: "unblock-confirmed", maxAttempts: 20 }
    );
    console.log("  ✓ Unblock confirmed");

    // ── 6. Verify Charlie can now follow Alice ───────────────────────────────
    console.log("[social] 6: Charlie follows Alice (restored)...");
    await submitContractTx(sdk, accounts.charlie, "follow", [
      scvAddress(charlieAddr), scvAddress(aliceAddr),
    ]);

    await pollContractState(
      () => sdk.getFollowing(charlieAddr, 0, 10),
      (list) => list.includes(aliceAddr),
      { label: "charlie-follows-alice", maxAttempts: 20 }
    );
    console.log("  ✓ Follow restored after unblock");
  }, 180_000);
});
