/**
 * E2E Test: Social Graph Operations
 *
 * Tests social graph operations:
 *   Create 3 users → Follow chain (A follows B, B follows C) →
 *   Verify follower counts → Block user → Verify follow blocked →
 *   Unblock → Verify restore
 *
 * Uses the SDK for on-chain reads and the indexer API for indexed state.
 */

import {
  createTestKeypair,
  submitContractCall,
  waitForIndexedProfile,
  createClient,
  requireEnv,
  scvAddress,
  sleep,
  retry,
  type TestKeypair,
} from "./setup";

describe("E2E: Social Graph", () => {
  let alice: TestKeypair;
  let bob: TestKeypair;
  let charlie: TestKeypair;
  let client: ReturnType<typeof createClient>;
  let contractId: string;
  let tokenId: string;

  beforeAll(async () => {
    const env = requireEnv();
    contractId = env.contractId;
    tokenId = env.tokenId;
    client = createClient();

    // Create 3 funded accounts
    alice = await createTestKeypair(process.env.ALICE_SECRET);
    bob = await createTestKeypair(process.env.BOB_SECRET);
    charlie = await createTestKeypair(process.env.CHARLIE_SECRET);

    // Create profiles for all 3 users
    for (const [user, name] of [
      [alice, "alice_graph"],
      [bob, "bob_graph"],
      [charlie, "charlie_graph"],
    ] as const) {
      const txHash = await submitContractCall(
        "set_profile",
        [scvAddress(user.address), scvString(name), scvAddress(tokenId)],
        user.keypair,
        contractId
      );
      expect(txHash).toBeTruthy();
      await waitForIndexedProfile(user.address);
    }
  });

  test("1. Follow chain: Alice follows Bob, Bob follows Charlie", async () => {
    // Alice follows Bob
    let txHash = await submitContractCall(
      "follow",
      [scvAddress(alice.address), scvAddress(bob.address)],
      alice.keypair,
      contractId
    );
    expect(txHash).toBeTruthy();
    console.log(`  Alice → Bob: tx=${txHash}`);

    // Bob follows Charlie
    txHash = await submitContractCall(
      "follow",
      [scvAddress(bob.address), scvAddress(charlie.address)],
      bob.keypair,
      contractId
    );
    expect(txHash).toBeTruthy();
    console.log(`  Bob → Charlie: tx=${txHash}`);

    await sleep(5000);
  });

  test("2. Verify follower counts on-chain", async () => {
    // Alice follows: [Bob]
    const aliceFollowing = await retry(() =>
      client.getFollowing(alice.address, 0, 10)
    );
    expect(aliceFollowing).toContain(bob.address);

    // Bob follows: [Charlie]
    const bobFollowing = await retry(() =>
      client.getFollowing(bob.address, 0, 10)
    );
    expect(bobFollowing).toContain(charlie.address);

    // Bob's followers: [Alice]
    const bobFollowers = await retry(() =>
      client.getFollowers(bob.address, 0, 10)
    );
    expect(bobFollowers).toContain(alice.address);

    // Charlie's followers: [Bob]
    const charlieFollowers = await retry(() =>
      client.getFollowers(charlie.address, 0, 10)
    );
    expect(charlieFollowers).toContain(bob.address);
  });

  test("3. Verify follower counts via indexer API", async () => {
    // Verify via indexer API that follows are indexed
    const res = await retry(async () => {
      const r = await fetch(
        `${requireEnv().indexerUrl}/api/follows/following/${bob.address}`
      );
      if (!r.ok) throw new Error(`Indexer not ready: ${r.status}`);
      return r.json();
    });

    // Bob should have follow data indexed
    expect(res).toBeDefined();
  });

  test("4. Alice blocks Bob", async () => {
    // Alice blocks Bob
    const txHash = await submitContractCall(
      "block_user",
      [scvAddress(alice.address), scvAddress(bob.address)],
      alice.keypair,
      contractId
    );
    expect(txHash).toBeTruthy();
    console.log(`  Alice blocks Bob: tx=${txHash}`);

    await sleep(3000);

    // Verify on-chain: Alice has blocked Bob
    const isBlocked = await retry(() =>
      client.isBlocked(alice.address, bob.address)
    );
    expect(isBlocked).toBe(true);

    // Verify Bob cannot follow Alice (if he tries to re-follow)
    // Expected: the follow should fail or be blocked at contract level
    await expect(
      submitContractCall(
        "follow",
        [scvAddress(bob.address), scvAddress(alice.address)],
        bob.keypair,
        contractId
      )
    ).rejects.toThrow();
  });

  test("5. Alice unblocks Bob", async () => {
    // Alice unblocks Bob
    const txHash = await submitContractCall(
      "unblock_user",
      [scvAddress(alice.address), scvAddress(bob.address)],
      alice.keypair,
      contractId
    );
    expect(txHash).toBeTruthy();
    console.log(`  Alice unblocks Bob: tx=${txHash}`);

    await sleep(3000);

    // Verify on-chain: Alice no longer has Bob blocked
    const isBlocked = await retry(() =>
      client.isBlocked(alice.address, bob.address)
    );
    expect(isBlocked).toBe(false);
  });

  test("6. Verify social graph restored after unblock", async () => {
    // After unblock, Bob should be able to follow Alice again
    const txHash = await submitContractCall(
      "follow",
      [scvAddress(bob.address), scvAddress(alice.address)],
      bob.keypair,
      contractId
    );
    expect(txHash).toBeTruthy();
    console.log(`  Bob follows Alice again: tx=${txHash}`);

    await sleep(3000);

    // Verify follow went through
    const aliceFollowers = await retry(() =>
      client.getFollowers(alice.address, 0, 10)
    );
    expect(aliceFollowers).toContain(bob.address);
  });
});
