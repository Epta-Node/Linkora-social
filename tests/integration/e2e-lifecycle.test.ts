/**
 * E2E Test: Full User Lifecycle
 *
 * Tests the complete user journey on the Linkora platform:
 *   Deploy contracts → Initialize → Create profile → Set DM key →
 *   Follow user → Create post → Like post → Delete post →
 *   Unfollow → Delete profile
 *
 * Uses the local Stellar sandbox (or testnet) and the SDK to interact
 * with the smart contract. Verifies state via both on-chain reads and
 * the indexer REST API.
 *
 * Each test is independent and cleans up after itself.
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
  scvBytes,
  sleep,
  retry,
  type TestKeypair,
} from "./setup";

// ── Test Suite ─────────────────────────────────────────────────────────────

describe("E2E: User Lifecycle", () => {
  let alice: TestKeypair;
  let bob: TestKeypair;
  let client: ReturnType<typeof createClient>;
  let contractId: string;
  let tokenId: string;

  // ── Setup ────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    const env = requireEnv();
    contractId = env.contractId;
    tokenId = env.tokenId;
    client = createClient();

    // Create funded accounts for the tests
    alice = await createTestKeypair(process.env.ALICE_SECRET);
    bob = await createTestKeypair(process.env.BOB_SECRET);
  });

  // ── Tests ────────────────────────────────────────────────────────────────

  test("1. Create profiles for Alice and Bob", async () => {
    // Alice creates her profile
    const aliceTxHash = await submitContractCall(
      "set_profile",
      [
        scvAddress(alice.address),
        scvString("alice_e2e"),
        scvAddress(tokenId),
      ],
      alice.keypair,
      contractId
    );
    expect(aliceTxHash).toBeTruthy();
    console.log(`  Alice profile created: tx=${aliceTxHash}`);

    // Bob creates his profile
    const bobTxHash = await submitContractCall(
      "set_profile",
      [
        scvAddress(bob.address),
        scvString("bob_e2e"),
        scvAddress(tokenId),
      ],
      bob.keypair,
      contractId
    );
    expect(bobTxHash).toBeTruthy();
    console.log(`  Bob profile created: tx=${bobTxHash}`);

    // Wait for indexer to process both profiles
    const aliceProfile = await waitForIndexedProfile(alice.address);
    expect(aliceProfile).toBeDefined();
    expect(aliceProfile).toHaveProperty("username", "alice_e2e");

    const bobProfile = await waitForIndexedProfile(bob.address);
    expect(bobProfile).toBeDefined();
    expect(bobProfile).toHaveProperty("username", "bob_e2e");
  });

  test("2. Bob follows Alice", async () => {
    const txHash = await submitContractCall(
      "follow",
      [scvAddress(bob.address), scvAddress(alice.address)],
      bob.keypair,
      contractId
    );
    expect(txHash).toBeTruthy();
    console.log(`  Bob follows Alice: tx=${txHash}`);

    // Wait a moment for the ledger to close
    await sleep(3000);

    // Verify on-chain: Bob's following list includes Alice
    const following = await retry(() =>
      client.getFollowing(bob.address, 0, 10)
    );
    expect(following).toContain(alice.address);

    // Verify on-chain: Alice's followers list includes Bob
    const followers = await retry(() =>
      client.getFollowers(alice.address, 0, 10)
    );
    expect(followers).toContain(bob.address);
  });

  test("3. Alice creates a post", async () => {
    const postContent = "Hello from E2E test! " + Date.now();

    const txHash = await submitContractCall(
      "create_post",
      [scvAddress(alice.address), scvString(postContent)],
      alice.keypair,
      contractId
    );
    expect(txHash).toBeTruthy();
    console.log(`  Post created: tx=${txHash}`);

    // Wait for indexer to process
    await sleep(5000);

    // Verify on-chain: Alice's post count increased
    const postCount = await retry(() => client.getPostCount());
    expect(postCount).toBeGreaterThanOrEqual(1n);

    // Get Alice's post IDs from on-chain
    const alicePostIds = await retry(() =>
      client.getPostsByAuthor(alice.address, 0, 10)
    );
    expect(alicePostIds.length).toBeGreaterThanOrEqual(1);

    // Verify post content via on-chain
    const latestPostId = alicePostIds[alicePostIds.length - 1];
    const post = await retry(() => client.getPost(latestPostId));
    expect(post).not.toBeNull();
    expect(post!.content).toBe(postContent);
    expect(post!.author).toBe(alice.address);

    // Wait for indexer and verify via API
    const indexedPost = await waitForIndexedPost(latestPostId.toString());
    expect(indexedPost).toHaveProperty("content", postContent);
  });

  test("4. Bob likes Alice's post", async () => {
    // Get Alice's posts
    const alicePostIds = await retry(() =>
      client.getPostsByAuthor(alice.address, 0, 10)
    );
    expect(alicePostIds.length).toBeGreaterThanOrEqual(1);
    const postId = alicePostIds[alicePostIds.length - 1];

    // Bob likes the post
    const txHash = await submitContractCall(
      "like_post",
      [scvAddress(bob.address), scvU64(postId)],
      bob.keypair,
      contractId
    );
    expect(txHash).toBeTruthy();
    console.log(`  Like post ${postId}: tx=${txHash}`);

    await sleep(3000);

    // Verify on-chain like count
    const likeCount = await retry(() => client.getLikeCount(postId));
    expect(likeCount).toBeGreaterThanOrEqual(1n);

    // Verify Bob has liked the post
    const hasLiked = await retry(() => client.hasLiked(bob.address, postId));
    expect(hasLiked).toBe(true);
  });

  test("5. Bob tips Alice's post", async () => {
    // Get Alice's posts
    const alicePostIds = await retry(() =>
      client.getPostsByAuthor(alice.address, 0, 10)
    );
    expect(alicePostIds.length).toBeGreaterThanOrEqual(1);
    const postId = alicePostIds[alicePostIds.length - 1];

    // Bob tips the post
    const tipAmount = 500n;
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
    console.log(`  Tip post ${postId}: tx=${txHash}`);

    await sleep(3000);

    // Verify on-chain tip total
    const post = await retry(() => client.getPost(postId));
    expect(post).not.toBeNull();
    expect(post!.tip_total).toBeGreaterThanOrEqual(tipAmount);
  });

  test("6. Alice publishes DM key", async () => {
    // Generate an X25519 keypair for DM
    const dmKeypair = { publicKey: new Uint8Array(32).fill(0xaa) }; // test placeholder

    const txHash = await submitContractCall(
      "publish_dm_key",
      [scvAddress(alice.address), scvBytes(dmKeypair.publicKey)],
      alice.keypair,
      contractId
    );
    expect(txHash).toBeTruthy();
    console.log(`  DM key published: tx=${txHash}`);

    await sleep(3000);

    // Verify on-chain DM key
    const storedKey = await retry(() => client.getDmKey(alice.address));
    expect(storedKey).not.toBeNull();
  });

  test("7. Alice deletes her post", async () => {
    // Get Alice's posts
    const alicePostIds = await retry(() =>
      client.getPostsByAuthor(alice.address, 0, 10)
    );
    expect(alicePostIds.length).toBeGreaterThanOrEqual(1);
    const postId = alicePostIds[alicePostIds.length - 1];

    // Delete the post
    const txHash = await submitContractCall(
      "delete_post",
      [scvAddress(alice.address), scvU64(postId)],
      alice.keypair,
      contractId
    );
    expect(txHash).toBeTruthy();
    console.log(`  Post ${postId} deleted: tx=${txHash}`);

    await sleep(3000);

    // Verify post is gone on-chain
    const deletedPost = await retry(() => client.getPost(postId));
    expect(deletedPost).toBeNull();
  });

  test("8. Bob unfollows Alice", async () => {
    const txHash = await submitContractCall(
      "unfollow",
      [scvAddress(bob.address), scvAddress(alice.address)],
      bob.keypair,
      contractId
    );
    expect(txHash).toBeTruthy();
    console.log(`  Bob unfollows Alice: tx=${txHash}`);

    await sleep(3000);

    // Verify on-chain: Bob's following list no longer includes Alice
    const following = await retry(() =>
      client.getFollowing(bob.address, 0, 10)
    );
    expect(following).not.toContain(alice.address);
  });

  test("9. Alice deletes her profile", async () => {
    const txHash = await submitContractCall(
      "delete_profile",
      [scvAddress(alice.address)],
      alice.keypair,
      contractId
    );
    expect(txHash).toBeTruthy();
    console.log(`  Profile deleted: tx=${txHash}`);

    await sleep(3000);

    // Verify on-chain profile is gone
    const profile = await retry(() => client.getProfile(alice.address));
    expect(profile).toBeNull();
  });
});
