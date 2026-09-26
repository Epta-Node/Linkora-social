/**
 * Tests for DM relay helpers.
 *
 * Covers `getConversationId` determinism and `detectKeyRotation` logic.
 */

import { getConversationId, detectKeyRotation, buildDmAuthMessage, hashCiphertext } from "../relay";
import { sha256 } from "@noble/hashes/sha256";

// ── getConversationId ────────────────────────────────────────────────────────

describe("getConversationId", () => {
  it("is commutative — same result regardless of argument order", () => {
    const a = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const b = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    expect(getConversationId(a, b)).toBe(getConversationId(b, a));
  });

  it("produces a 64-character hex string", () => {
    const id = getConversationId("addr-a", "addr-b");
    expect(id).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(id)).toBe(true);
  });

  it("different address pairs produce different IDs", () => {
    const a = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const b = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    const c = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
    expect(getConversationId(a, b)).not.toBe(getConversationId(a, c));
  });
});

// ── detectKeyRotation ────────────────────────────────────────────────────────

function hex(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

describe("detectKeyRotation", () => {
  it("returns rotated=false when cachedKey is null (first sync)", () => {
    const onChain = hex("aabbccdd00112233445566778899aabbccddeeff00112233445566778899aabb");
    // Pad to 32 bytes
    const key = new Uint8Array(32);
    key.set(onChain.slice(0, Math.min(32, onChain.length)));
    const result = detectKeyRotation(null, key);
    expect(result.rotated).toBe(false);
    expect(result.currentKey).toBe(key);
  });

  it("returns rotated=false when keys are identical", () => {
    const key = new Uint8Array(32);
    key[0] = 0x42;
    key[31] = 0xff;

    const cached = new Uint8Array(key);
    const result = detectKeyRotation(cached, key);
    expect(result.rotated).toBe(false);
  });

  it("returns rotated=true when keys differ", () => {
    const cached = new Uint8Array(32);
    cached[0] = 0x00;

    const current = new Uint8Array(32);
    current[0] = 0x01;

    const result = detectKeyRotation(cached, current);
    expect(result.rotated).toBe(true);
    expect(result.currentKey).toBe(current);
  });

  it("returns rotated=true when lengths differ", () => {
    const cached = new Uint8Array(32);
    const current = new Uint8Array(16);

    const result = detectKeyRotation(cached, current);
    expect(result.rotated).toBe(true);
    expect(result.currentKey).toBe(current);
  });

  it("detects rotation when only the last byte changes", () => {
    const cached = new Uint8Array(32);
    const current = new Uint8Array(32);
    current[31] = 0xff;

    const result = detectKeyRotation(cached, current);
    expect(result.rotated).toBe(true);
  });
});

// ── buildDmAuthMessage ────────────────────────────────────────────────────────

describe("buildDmAuthMessage", () => {
  const to = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
  const nonce = 7;
  const timestamp = 1700000000;
  const ciphertextB64 = Buffer.from("sealed payload").toString("base64");

  it("pins the same canonical string the relay derives", () => {
    const digest = Buffer.from(sha256(new TextEncoder().encode(ciphertextB64))).toString("hex");
    expect(buildDmAuthMessage(to, nonce, timestamp, ciphertextB64)).toBe(
      `v2:${to}:${nonce}:${timestamp}:${digest}`
    );
  });

  it("hashes the ciphertext exactly as it appears on the wire", () => {
    expect(hashCiphertext(ciphertextB64)).toBe(
      Buffer.from(sha256(new TextEncoder().encode(ciphertextB64))).toString("hex")
    );
    expect(hashCiphertext(ciphertextB64)).toHaveLength(64);
  });

  it("changes the signed message when the ciphertext is substituted", () => {
    const original = buildDmAuthMessage(to, nonce, timestamp, ciphertextB64);
    const tampered = buildDmAuthMessage(
      to,
      nonce,
      timestamp,
      Buffer.from("attacker payload").toString("base64")
    );
    expect(tampered).not.toBe(original);
  });

  it("binds recipient, nonce and timestamp as well as the ciphertext", () => {
    const base = buildDmAuthMessage(to, nonce, timestamp, ciphertextB64);
    expect(buildDmAuthMessage("GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC", nonce, timestamp, ciphertextB64)).not.toBe(base);
    expect(buildDmAuthMessage(to, nonce + 1, timestamp, ciphertextB64)).not.toBe(base);
    expect(buildDmAuthMessage(to, nonce, timestamp + 1, ciphertextB64)).not.toBe(base);
  });
});
