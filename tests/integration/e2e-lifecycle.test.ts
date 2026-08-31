/**
 * E2E User Lifecycle Test
 *
 * Exercises the full user lifecycle with deterministic retry loops:
 *   1. Create profiles (alice, bob)
 *   2. Follow (bob follows alice)
 *   3. Create post (alice creates a post)
 *   4. Like post (bob likes alice's post)
 *   5. Tip post (bob tips alice's post)
 *   6. Indexer event verification (end-to-end on-chain → API)
 *   7. Delete post (alice deletes her post)
 *   8. Unfollow (bob unfollows alice)
 *
 * All indexer/contract state assertions use retry loops, not hardcoded sleeps.
 */

import { Keypair } from "@stellar/stellar-sdk";
import {
  bootstrap,
  teardown,
  submitContractTx,
  pollForProfile,
  pollForPost,
  pollContractState,
  indexerFetch,
  createSdkClient,
  scvAddress,
  scvString,
  scvU64,
  scvI128,
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

function addr(kp: Keypair): string {
  return kp.publicKey();
}

describe("User Lifecycle E2E", () => {
  test("Full user lifecycle (profile → social → tipping → cleanup)", async () => {
    const cid = contracts.contractId;
    const tid = contracts.tokenId;

    // ── 1. Alice creates profile ──────────────────────────────────────────────
    console.log("\n[lifecycle] 1: Alice creates profile...");
    await submitContractTx(sdk, accounts.alice, "set_profile", [
      scvAddress(addr(accounts.alice)),
      scvString("alice_e2e"),
      scvAddress(tid),
    ]);

    await pollForProfile(addr(accounts.alice));
    console.log("  ✓ Alice profile indexed");

    // ── 2. Bob creates profile ────────────────────────────────────────────────
    console.log("[lifecycle] 2: Bob creates profile...");
    await submitContractTx(sdk, accounts.bob, "set_profile", [
      scvAddress(addr(accounts.bob)),
      scvString("bob_e2e"),
      scvAddress(tid),
    ]);

    await pollForProfile(addr(accounts.bob));
    console.log("  ✓ Bob profile indexed");

    // ── 3. Bob follows Alice ───────────────────────────────────────────────────
    console.log("[lifecycle] 3: Bob follows Alice...");
    await submitContractTx(sdk, accounts.bob, "follow", [
      scvAddress(addr(accounts.bob)),
      scvAddress(addr(accounts.alice)),
    ]);

    // Retry polling indexer until Alice appears in Bob's following list
    await pollContractState(
      () => indexerFetch<{ following: string[] }>(
        `/api/follows/${addr(accounts.bob)}/following?limit=10`
      ),
      (resp) => !!resp.data?.following?.some((f: string) => f === addr(accounts.alice)),
      { label: "bob-follows-alice-indexer", maxAttempts: 30, baseDelayMs: 500 }
    );
    console.log("  ✓ Bob follows Alice (confirmed via indexer)");

    // ── 4. Alice creates a post ────────────────────────────────────────────────
    console.log("[lifecycle] 4: Alice creates post...");
    // The post ID is returned as part of the create_post response.
    // We retrieve it by checking the post count after submission.
    const postCountBefore = await sdk.getPostCount();
    await submitContractTx(sdk, accounts.alice, "create_post", [
      scvAddress(addr(accounts.alice)),
      scvString("Hello from E2E test! This is post 1."),
    ]);

    const alicePostId = await pollContractState(
      () => sdk.getPostCount(),
      (count) => count > postCountBefore,
      { label: "post-count-increase", maxAttempts: 20, baseDelayMs: 500 }
    );
    const postId = String(alicePostId);
    await pollForPost(postId);
    console.log(`  ✓ Post ${postId} created and indexed`);

    // ── 5. Bob likes Alice's post ──────────────────────────────────────────────
    console.log("[lifecycle] 5: Bob likes Alice's post...");
    await submitContractTx(sdk, accounts.bob, "like_post", [
      scvAddress(addr(accounts.bob)),
      scvU64(BigInt(postId)),
    ]);

    await pollContractState(
      () => sdk.getPost(BigInt(postId)).then((p) => p?.like_count ?? 0n),
      (likes) => likes >= 1n,
      { label: "like-count", maxAttempts: 20, baseDelayMs: 500 }
    );
    console.log("  ✓ Like confirmed on-chain");

    // ── 6. Bob tips Alice's post ───────────────────────────────────────────────
    console.log("[lifecycle] 6: Bob tips Alice's post (amount: 1000)...");
    await submitContractTx(sdk, accounts.bob, "tip", [
      scvAddress(addr(accounts.bob)),
      scvU64(BigInt(postId)),
      scvAddress(tid),
      scvI128(1000),
    ]);

    await pollContractState(
      () => sdk.getPost(BigInt(postId)).then((p) => p?.tip_total ?? 0n),
      (tipTotal) => tipTotal >= 1000n,
      { label: "tip-total", maxAttempts: 20, baseDelayMs: 500 }
    );
    console.log("  ✓ Tip confirmed on-chain");

    // ── 7. Indexer event verification (end-to-end) ─────────────────────────────
    console.log("[lifecycle] 7: Verifying indexer reflects tip...");
    const indexedPost = await pollForPost(postId);
    expect(indexedPost).not.toBeNull();
    const postData = indexedPost as Record<string, unknown>;
    const tipTotal =
      typeof postData.tip_total === "string"
        ? BigInt(postData.tip_total as string)
        : BigInt(String(postData.tip_total || 0));
    expect(tipTotal).toBeGreaterThanOrEqual(1000n);
    console.log("  ✓ Indexer reflects tip end-to-end");

    // ── 8. Alice deletes her post ──────────────────────────────────────────────
    console.log("[lifecycle] 8: Alice deletes her post...");
    await submitContractTx(sdk, accounts.alice, "delete_post", [
      scvAddress(addr(accounts.alice)),
      scvU64(BigInt(postId)),
    ]);
    console.log("  ✓ Post deleted (on-chain tombstone set)");

    // ── 9. Bob unfollows Alice ─────────────────────────────────────────────────
    console.log("[lifecycle] 9: Bob unfollows Alice...");
    await submitContractTx(sdk, accounts.bob, "unfollow", [
      scvAddress(addr(accounts.bob)),
      scvAddress(addr(accounts.alice)),
    ]);

    await pollContractState(
      () => indexerFetch<{ following: string[] }>(
        `/api/follows/${addr(accounts.bob)}/following?limit=10`
      ),
      (resp) => !resp.data?.following?.some((f: string) => f === addr(accounts.alice)),
      { label: "bob-unfollows-alice", maxAttempts: 30, baseDelayMs: 500 }
    );
    console.log("  ✓ Bob unfollowed Alice (confirmed via indexer)");
  }, 180_000);
});
