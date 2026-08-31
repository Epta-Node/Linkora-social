/**
 * Tests for DM storage — key rotation detection and session key invalidation.
 *
 * Validates that:
 *  1. A key rotation is detected when the on-chain key changes.
 *  2. Cached session keys are cleared on rotation.
 *  3. The sync cursor is reset so messages under the new key are fetched.
 *  4. First-time sync does NOT flag a rotation.
 */

import {
  hasDmKeypair,
  storeDmKeypair,
  loadDmKeypair,
  clearDmKeypair,
  storePublishedKey,
  loadPublishedKey,
  hasKeyRotated,
  recordKeyRotation,
  storeSessionKey,
  loadSessionKey,
  invalidateAllSessionKeys,
  invalidateSessionKey,
  storeSyncCursor,
  loadSyncCursor,
} from "../storage";
import { bytesToBase64, base64ToBytes } from "../crypto";

// ── Helpers ──────────────────────────────────────────────────────────────────

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

const ALICE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const BOB = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const CHARLIE = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

beforeEach(() => {
  localStorage.clear();
});

// ── Keypair persistence (smoke tests) ───────────────────────────────────────

describe("DmKeyPair persistence", () => {
  it("stores and loads a keypair round-trip", () => {
    const kp = { publicKey: randomBytes(32), privateKey: randomBytes(32) };
    storeDmKeypair(ALICE, kp);
    expect(hasDmKeypair(ALICE)).toBe(true);

    const loaded = loadDmKeypair(ALICE);
    expect(loaded).not.toBeNull();
    expect(bytesToBase64(loaded!.publicKey)).toBe(bytesToBase64(kp.publicKey));
    expect(bytesToBase64(loaded!.privateKey)).toBe(bytesToBase64(kp.privateKey));
  });

  it("clearDmKeypair removes the stored keys", () => {
    storeDmKeypair(ALICE, { publicKey: randomBytes(32), privateKey: randomBytes(32) });
    clearDmKeypair(ALICE);
    expect(hasDmKeypair(ALICE)).toBe(false);
    expect(loadDmKeypair(ALICE)).toBeNull();
  });

  it("accounts are isolated", () => {
    const kpA = { publicKey: randomBytes(32), privateKey: randomBytes(32) };
    const kpB = { publicKey: randomBytes(32), privateKey: randomBytes(32) };
    storeDmKeypair(ALICE, kpA);
    storeDmKeypair(BOB, kpB);

    const loadedA = loadDmKeypair(ALICE);
    const loadedB = loadDmKeypair(BOB);
    expect(bytesToBase64(loadedA!.publicKey)).toBe(bytesToBase64(kpA.publicKey));
    expect(bytesToBase64(loadedB!.publicKey)).toBe(bytesToBase64(kpB.publicKey));
    expect(bytesToBase64(loadedA!.publicKey)).not.toBe(bytesToBase64(loadedB!.publicKey));
  });
});

// ── On-chain key tracking ────────────────────────────────────────────────────

describe("published key tracking", () => {
  it("loadPublishedKey returns null when nothing is stored", () => {
    expect(loadPublishedKey(ALICE)).toBeNull();
  });

  it("storePublishedKey and loadPublishedKey round-trip", () => {
    const key = randomBytes(32);
    storePublishedKey(ALICE, key);
    const loaded = loadPublishedKey(ALICE);
    expect(loaded).not.toBeNull();
    expect(bytesToBase64(loaded!)).toBe(bytesToBase64(key));
  });
});

// ── Key rotation detection ───────────────────────────────────────────────────

describe("hasKeyRotated", () => {
  it("returns false on first sync (no cached key)", () => {
    const onChain = randomBytes(32);
    expect(hasKeyRotated(ALICE, onChain)).toBe(false);
  });

  it("returns false when the key has not changed", () => {
    const key = randomBytes(32);
    storePublishedKey(ALICE, key);
    expect(hasKeyRotated(ALICE, key)).toBe(false);
  });

  it("returns true when the key has changed", () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    storePublishedKey(ALICE, oldKey);
    expect(hasKeyRotated(ALICE, newKey)).toBe(true);
  });

  it("returns true when key length differs", () => {
    const key32 = randomBytes(32);
    const key16 = randomBytes(16);
    storePublishedKey(ALICE, key32);
    expect(hasKeyRotated(ALICE, key16)).toBe(true);
  });
});

// ── Session key cache ────────────────────────────────────────────────────────

describe("session key cache", () => {
  it("returns null when no session key is cached", () => {
    expect(loadSessionKey(ALICE, BOB)).toBeNull();
  });

  it("stores and loads a session key round-trip", () => {
    const secret = randomBytes(32);
    storeSessionKey(ALICE, BOB, secret);
    const loaded = loadSessionKey(ALICE, BOB);
    expect(loaded).not.toBeNull();
    expect(bytesToBase64(loaded!)).toBe(bytesToBase64(secret));
  });

  it("different peers have isolated session keys", () => {
    const secretAB = randomBytes(32);
    const secretAC = randomBytes(32);
    storeSessionKey(ALICE, BOB, secretAB);
    storeSessionKey(ALICE, CHARLIE, secretAC);

    expect(bytesToBase64(loadSessionKey(ALICE, BOB)!)).toBe(bytesToBase64(secretAB));
    expect(bytesToBase64(loadSessionKey(ALICE, CHARLIE)!)).toBe(bytesToBase64(secretAC));
  });
});

// ── Session key invalidation ─────────────────────────────────────────────────

describe("session key invalidation", () => {
  it("invalidateSessionKey removes a single conversation's session key", () => {
    storeSessionKey(ALICE, BOB, randomBytes(32));
    storeSessionKey(ALICE, CHARLIE, randomBytes(32));

    invalidateSessionKey(ALICE, BOB);

    expect(loadSessionKey(ALICE, BOB)).toBeNull();
    expect(loadSessionKey(ALICE, CHARLIE)).not.toBeNull();
  });

  it("invalidateAllSessionKeys clears every session key for an address", () => {
    storeSessionKey(ALICE, BOB, randomBytes(32));
    storeSessionKey(ALICE, CHARLIE, randomBytes(32));
    // Also add a key for a different user to ensure isolation
    storeSessionKey(BOB, ALICE, randomBytes(32));

    invalidateAllSessionKeys(ALICE);

    expect(loadSessionKey(ALICE, BOB)).toBeNull();
    expect(loadSessionKey(ALICE, CHARLIE)).toBeNull();
    // BOB's session keys should be untouched
    expect(loadSessionKey(BOB, ALICE)).not.toBeNull();
  });

  it("invalidateAllSessionKeys resets the sync cursor", () => {
    storeSyncCursor(ALICE, "seq-42");
    invalidateAllSessionKeys(ALICE);
    expect(loadSyncCursor(ALICE)).toBeNull();
  });
});

// ── Sync cursor ──────────────────────────────────────────────────────────────

describe("sync cursor", () => {
  it("returns null when no cursor is stored", () => {
    expect(loadSyncCursor(ALICE)).toBeNull();
  });

  it("stores and loads a cursor round-trip", () => {
    storeSyncCursor(ALICE, "seq-100");
    expect(loadSyncCursor(ALICE)).toBe("seq-100");
  });

  it("cursor is address-specific", () => {
    storeSyncCursor(ALICE, "seq-100");
    storeSyncCursor(BOB, "seq-200");
    expect(loadSyncCursor(ALICE)).toBe("seq-100");
    expect(loadSyncCursor(BOB)).toBe("seq-200");
  });
});

// ── Full rotation-then-resync path ───────────────────────────────────────────

describe("rotation-then-resync path", () => {
  it("detects rotation, invalidates session keys, and resets cursor", () => {
    // 1. Simulate initial state: ALICE has a keypair and a cached published key
    const initialPub = randomBytes(32);
    storeDmKeypair(ALICE, { publicKey: initialPub, privateKey: randomBytes(32) });
    storePublishedKey(ALICE, initialPub);

    // 2. Cache session keys for conversations with BOB and CHARLIE
    storeSessionKey(ALICE, BOB, randomBytes(32));
    storeSessionKey(ALICE, CHARLIE, randomBytes(32));

    // 3. Store a sync cursor
    storeSyncCursor(ALICE, "seq-50");
    expect(loadSyncCursor(ALICE)).toBe("seq-50");

    // 4. Simulate a key rotation: the on-chain key has changed
    const rotatedPub = randomBytes(32);
    expect(hasKeyRotated(ALICE, rotatedPub)).toBe(true);

    // 5. On rotation, invalidate all session keys and reset cursor
    invalidateAllSessionKeys(ALICE);
    recordKeyRotation(ALICE, rotatedPub);

    // 6. Verify session keys are cleared
    expect(loadSessionKey(ALICE, BOB)).toBeNull();
    expect(loadSessionKey(ALICE, CHARLIE)).toBeNull();

    // 7. Verify sync cursor was reset
    expect(loadSyncCursor(ALICE)).toBeNull();

    // 8. Verify the published key was updated to the new one
    expect(hasKeyRotated(ALICE, rotatedPub)).toBe(false);
    expect(bytesToBase64(loadPublishedKey(ALICE)!)).toBe(bytesToBase64(rotatedPub));
  });

  it("does not flag rotation when key is unchanged", () => {
    const key = randomBytes(32);
    storePublishedKey(ALICE, key);
    storeSessionKey(ALICE, BOB, randomBytes(32));
    storeSyncCursor(ALICE, "seq-99");

    // Simulate a sync where the on-chain key matches the cached key
    expect(hasKeyRotated(ALICE, key)).toBe(false);

    // Session keys and cursor should remain intact
    expect(loadSessionKey(ALICE, BOB)).not.toBeNull();
    expect(loadSyncCursor(ALICE)).toBe("seq-99");
  });
});
