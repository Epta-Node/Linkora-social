/**
 * E2E Test: Tipping Flow
 *
 * Tests the tipping functionality:
 *   Create profiles → Create post → Send tip →
 *   Verify tip amount → Verify tip cooldown → Delete cleanup
 *
 * Uses the SDK for on-chain reads and the indexer API for indexed state.
 */

import {
  createTestKeypair,
  submitContractCall,
  waitForIndexedProfile,
  waitForIndexedPost,
  createClient,
  requireEnv,
  scvAddress,
  scvString,
  scvU64,
  scvI128,
  sleep,
  retry,
  type TestKeypair,
} from "./setup";

describe("E2E: Tipping Flow", () => {
  let alice: TestKeypair;
  let bob: TestKeypair;
  let client: ReturnType<typeof createClient>;
  let contractId: string;
  let tokenId: string;
  let postId: bigint;

  beforeAll(async () => {
    const env = requireEnv();
    contractId = env.contractId;
    tokenId = env.tokenId;
    client = createClient();

    // Create funded accounts
    alice = await createTestKeypair(process.env.ALICE_SECRET);
    bob = await createTestKeypair(process.env.BOB_SECRET);

    // Create profiles
    for (const [user, name] of [
      [alice, "alice_tip"],
      [bob, "bob_tip"],
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

    // Alice creates a post that Bob will tip
    const postContent = "Tipping test post " + Date.now();
    const postTx = await submitContractCall(
      "create_post",
      [scvAddress(alice.address), scvString(postContent)],
      alice.keypair,
      contractId
    );
    expect(postTx).toBeTruthy();
    await sleep(5000);
  });

  test("1. Bob sends a tip to Alice's post", async () => {
    // Get Alice's post
    const alicePostIds = await retry(() =>
      client.getPostsByAuthor(alice.address, 0, 10)
    );
    expect(alicePostIds.length).toBeGreaterThanOrEqual(1);
    postId = alicePostIds[alicePostIds.length - 1];
    console.log(`  Post ID: ${postId}`);

    // Bob tips the post
    const tipAmount = 1000n;
    const txHash = await submitContractCall(
      "tip",
      [
        scvAddress(bob.address),
        scvU64(postId),
        scvAddress(tokenId),
        scvI128(tipAmount),
      ],
      bob.keypair,
      contractId
    );
    expect(txHash).toBeTruthy();
    console.log(`  Tip of ${tipAmount}: tx=${txHash}`);

    await sleep(3000);
  });

  test("2. Verify tip amount on-chain", async () => {
    // Check on-chain post state
    const post = await retry(() => client.getPost(postId));
    expect(post).not.toBeNull();
    expect(post!.tip_total).toBeGreaterThanOrEqual(1000n);
    console.log(`  Post tip_total: ${post!.tip_total}`);
  });

  test("3. Verify tip is indexed by the indexer", async () => {
    // Wait for indexer to process the tip event
    const indexedPost = await waitForIndexedPost(postId.toString());
    expect(indexedPost).toHaveProperty("tip_total");

    // The tip total in the indexer should match on-chain
    const indexedTipTotal = BigInt(String(indexedPost.tip_total || "0"));
    expect(indexedTipTotal).toBeGreaterThanOrEqual(1000n);
    console.log(`  Indexed tip_total: ${indexedTipTotal}`);
  });

  test("4. Bob sends another tip (larger amount)", async () => {
    const secondTipAmount = 2500n;
    const txHash = await submitContractCall(
      "tip",
      [
        scvAddress(bob.address),
        scvU64(postId),
        scvAddress(tokenId),
        scvI128(secondTipAmount),
      ],
      bob.keypair,
      contractId
    );
    expect(txHash).toBeTruthy();
    console.log(`  Second tip of ${secondTipAmount}: tx=${txHash}`);

    await sleep(3000);

    // Verify accumulated tips
    const post = await retry(() => client.getPost(postId));
    expect(post).not.toBeNull();
    expect(post!.tip_total).toBeGreaterThanOrEqual(3500n);
    console.log(`  Accumulated tip_total: ${post!.tip_total}`);
  });

  test("5. Verify tip cooldown window exists", async () => {
    // Check the tip cooldown window
    const cooldownWindow = await retry(() =>
      client.getTipCooldownWindow()
    );
    console.log(`  Tip cooldown window: ${cooldownWindow} ledgers`);
    // Cooldown should be a non-negative number
    expect(typeof cooldownWindow).toBe("number");
    expect(cooldownWindow).toBeGreaterThanOrEqual(0);
  });

  test("6. Verify tip counts via indexer API", async () => {
    // Check the indexer API for tip data
    const env = requireEnv();
    const res = await retry(async () => {
      const r = await fetch(`${env.indexerUrl}/api/posts/${postId}`);
      if (!r.ok) throw new Error(`Indexer not ready: ${r.status}`);
      return r.json();
    });

    expect(res).toHaveProperty("tip_total");
    console.log(`  Indexer API tip data: ${JSON.stringify(res.tip_total)}`);
  });
});
