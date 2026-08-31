/**
 * E2E Tipping Flow Test
 *
 * Uses SDK-based transactions and retry loops:
 *   1. Create profiles
 *   2. Create a post
 *   3. Tip the post
 *   4. Verify tip on-chain (retry loop)
 *   5. Verify tip via indexer (retry loop)
 *   6. Second tip from another user
 *   7. Verify cumulative total
 *
 * No hardcoded sleeps — all state assertions use pollContractState.
 */

import {
  bootstrap,
  teardown,
  submitContractTx,
  pollForProfile,
  pollForPost,
  pollContractState,
  indexerFetch,
  createSdkClient,
  getContractPost,
  scvAddress,
  scvString,
  scvU64,
  scvI128,
} from "./setup";

let accounts: Awaited<ReturnType<typeof bootstrap>>["accounts"];
let contracts: Awaited<ReturnType<typeof bootstrap>>["contracts"];
let sdk: ReturnType<typeof createSdkClient>;
let cfgDir: string = "";
let postId: string = "";

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

describe("Tipping E2E", () => {
  test("Tipping flow (tip creation, cumulative totals, event verification)", async () => {
    const cid = contracts.contractId;
    const tid = contracts.tokenId;
    const aliceAddr = addr(accounts.alice);
    const bobAddr = addr(accounts.bob);
    const charlieAddr = addr(accounts.charlie);

    // ── 1. Create profiles ────────────────────────────────────────────────────
    console.log("\n[tipping] 1: Creating profiles...");
    await submitContractTx(sdk, accounts.alice, "set_profile", [
      scvAddress(aliceAddr), scvString("alice_tip"), scvAddress(tid),
    ]);
    await submitContractTx(sdk, accounts.bob, "set_profile", [
      scvAddress(bobAddr), scvString("bob_tip"), scvAddress(tid),
    ]);
    await pollForProfile(aliceAddr);
    await pollForProfile(bobAddr);
    console.log("  ✓ Profiles created");

    // ── 2. Alice creates a post ────────────────────────────────────────────────
    console.log("[tipping] 2: Alice creates a post...");
    const postCountBefore = await sdk.getPostCount();
    await submitContractTx(sdk, accounts.alice, "create_post", [
      scvAddress(aliceAddr),
      scvString("Tip me! E2E tipping test post."),
    ]);

    const newCount = await pollContractState(
      () => sdk.getPostCount(),
      (c) => c > postCountBefore,
      { label: "post-count" }
    );
    postId = String(newCount);
    await pollForPost(postId);
    console.log(`  ✓ Post ${postId} created`);

    // ── 3. Bob tips Alice (first tip) ──────────────────────────────────────────
    console.log("[tipping] 3: Bob tips Alice (500)...");
    await submitContractTx(sdk, accounts.bob, "tip", [
      scvAddress(bobAddr),      scvU64(BigInt(postId)), scvAddress(tid), scvI128(500),
    ]);

    await pollContractState(
      () => getContractPost(BigInt(postId), cid).then((p) => p?.tip_total ?? 0n),
      (total) => total >= 500n,
      { label: "first-tip-on-chain", maxAttempts: 20 }
    );
    console.log("  ✓ First tip confirmed on-chain");

    // Verify via indexer
    await pollContractState(
      () => indexerFetch<Record<string, unknown>>(`/api/posts/${postId}`),
      (resp) => {
        if (!resp.data) return false;
        const tipTotal = typeof resp.data.tip_total === "string"
          ? BigInt(resp.data.tip_total as string)
          : BigInt(String(resp.data.tip_total || 0));
        return tipTotal >= 500n;
      },
      { label: "first-tip-indexer" }
    );
    console.log("  ✓ First tip reflected in indexer");

    // ── 4. Charlie sends second tip ────────────────────────────────────────────
    console.log("[tipping] 4: Charlie tips Alice (1500)...");
    await submitContractTx(sdk, accounts.charlie, "tip", [
      scvAddress(charlieAddr),      scvU64(BigInt(postId)), scvAddress(tid), scvI128(1500),
    ]);

    await pollContractState(
      () => getContractPost(BigInt(postId), cid).then((p) => p?.tip_total ?? 0n),
      (total) => total >= 2000n,
      { label: "cumulative-tip-on-chain", maxAttempts: 20 }
    );
    console.log("  ✓ Cumulative tip >= 2000 confirmed on-chain");

    // Verify final state via indexer
    await pollContractState(
      () => indexerFetch<Record<string, unknown>>(`/api/posts/${postId}`),
      (resp) => {
        if (!resp.data) return false;
        const tipTotal = typeof resp.data.tip_total === "string"
          ? BigInt(resp.data.tip_total as string)
          : BigInt(String(resp.data.tip_total || 0));
        return tipTotal >= 2000n;
      },
      { label: "cumulative-tip-indexer" }
    );
    console.log("  ✓ Final tip total verified via indexer");
  }, 180_000);
});
