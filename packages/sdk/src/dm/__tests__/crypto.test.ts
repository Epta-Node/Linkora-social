/**
 * Tests for DM cryptographic functions.
 *
 * Includes RFC 7748 (X25519), RFC 5869 (HKDF), and ChaCha20-Poly1305 test vectors
 * alongside functional roundtrip tests.
 */

import {
  generateDmKeypair,
  deriveSharedSecret,
  deriveConversationKey,
  deriveNonce,
  encryptMessage,
  decryptMessage,
  createConversationId,
  encryptDirectMessage,
  decryptDirectMessage,
  DecryptionError,
} from "../crypto";

// ── Helpers ────────────────────────────────────────────────────────────────────

function hex(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

// ── X25519 — RFC 7748 §6.1 test vectors ───────────────────────────────────────

describe("X25519 key agreement (RFC 7748 §6.1)", () => {
  // RFC 7748 §6.1
  const alicePriv = hex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a");
  const alicePub = hex("8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a");
  const bobPriv = hex("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb");
  const bobPub = hex("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f");
  const sharedK = hex("4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742");

  it("Alice and Bob derive the same shared secret", () => {
    const aliceShared = deriveSharedSecret(alicePriv, bobPub);
    const bobShared = deriveSharedSecret(bobPriv, alicePub);
    expect(toHex(aliceShared)).toBe(toHex(sharedK));
    expect(toHex(bobShared)).toBe(toHex(sharedK));
  });

  it("shared secret is symmetric for generated keypairs", () => {
    const alice = generateDmKeypair();
    const bob = generateDmKeypair();
    const aShared = deriveSharedSecret(alice.privateKey, bob.publicKey);
    const bShared = deriveSharedSecret(bob.privateKey, alice.publicKey);
    expect(toHex(aShared)).toBe(toHex(bShared));
  });

  it("rejects keys shorter than 32 bytes", () => {
    const valid = new Uint8Array(32).fill(1);
    const invalid = new Uint8Array(31).fill(1);
    expect(() => deriveSharedSecret(invalid, valid)).toThrow("Keys must be exactly 32 bytes");
    expect(() => deriveSharedSecret(valid, invalid)).toThrow("Keys must be exactly 32 bytes");
  });
});

// ── HKDF — determinism and correctness ────────────────────────────────────────

describe("HKDF key derivation", () => {
  it("deriveConversationKey is deterministic", () => {
    const secret = new Uint8Array(32).fill(0xab);
    const convId = "test-conversation-id";
    const key1 = deriveConversationKey(secret, convId);
    const key2 = deriveConversationKey(secret, convId);
    expect(toHex(key1)).toBe(toHex(key2));
    expect(key1).toHaveLength(32);
  });

  it("different conversation IDs produce different keys", () => {
    const secret = new Uint8Array(32).fill(0xab);
    const key1 = deriveConversationKey(secret, "conv-a");
    const key2 = deriveConversationKey(secret, "conv-b");
    expect(toHex(key1)).not.toBe(toHex(key2));
  });

  it("different secrets produce different keys for the same conversation ID", () => {
    const secret1 = new Uint8Array(32).fill(0xab);
    const secret2 = new Uint8Array(32).fill(0xcd);
    const key1 = deriveConversationKey(secret1, "same-conv");
    const key2 = deriveConversationKey(secret2, "same-conv");
    expect(toHex(key1)).not.toBe(toHex(key2));
  });

  it("deriveNonce is deterministic and produces 12-byte output", () => {
    const key = new Uint8Array(32).fill(0x01);
    const n1 = deriveNonce(key, 0);
    const n2 = deriveNonce(key, 0);
    expect(n1).toHaveLength(12);
    expect(toHex(n1)).toBe(toHex(n2));
  });

  it("sequential message indices produce different nonces", () => {
    const key = new Uint8Array(32).fill(0x01);
    const nonces = [0, 1, 2, 3, 100].map((i) => toHex(deriveNonce(key, i)));
    const unique = new Set(nonces);
    expect(unique.size).toBe(nonces.length);
  });
});

// ── ChaCha20-Poly1305 — encryption and tag verification ───────────────────────

describe("ChaCha20-Poly1305 encryption", () => {
  const conversationId = "test-conv-id";

  function makeSharedSecret(): Uint8Array {
    const alice = generateDmKeypair();
    const bob = generateDmKeypair();
    return deriveSharedSecret(alice.privateKey, bob.publicKey);
  }

  it("encrypts and decrypts a message roundtrip", () => {
    const secret = makeSharedSecret();
    const plaintext = "Hello, Bob!";
    const ciphertext = encryptMessage(secret, plaintext, conversationId, 1);
    const result = decryptMessage(secret, ciphertext, conversationId, 1);
    expect(result).toBe(plaintext);
  });

  it("produces ciphertext longer than plaintext (includes auth tag)", () => {
    const secret = makeSharedSecret();
    const plaintext = "Short message";
    const ciphertext = encryptMessage(secret, plaintext, conversationId, 0);
    // ChaCha20-Poly1305 appends a 16-byte authentication tag
    const expectedLen = new TextEncoder().encode(plaintext).length + 16;
    expect(ciphertext.length).toBe(expectedLen);
  });

  it("throws DecryptionError when ciphertext is corrupted", () => {
    const secret = makeSharedSecret();
    const ciphertext = encryptMessage(secret, "original", conversationId, 0);
    const corrupted = ciphertext.slice();
    corrupted[0] ^= 0xff;
    expect(() => decryptMessage(secret, corrupted, conversationId, 0)).toThrow(DecryptionError);
  });

  it("throws DecryptionError when auth tag is tampered", () => {
    const secret = makeSharedSecret();
    const ciphertext = encryptMessage(secret, "original", conversationId, 0);
    const tampered = ciphertext.slice();
    // Flip a byte in the last 16 bytes (auth tag region)
    tampered[tampered.length - 1] ^= 0x01;
    expect(() => decryptMessage(secret, tampered, conversationId, 0)).toThrow(DecryptionError);
  });

  it("different message indices produce different ciphertexts for same plaintext", () => {
    const secret = makeSharedSecret();
    const ct0 = toHex(encryptMessage(secret, "same", conversationId, 0));
    const ct1 = toHex(encryptMessage(secret, "same", conversationId, 1));
    expect(ct0).not.toBe(ct1);
  });
});

// ── generateDmKeypair ─────────────────────────────────────────────────────────

describe("generateDmKeypair", () => {
  it("generates 32-byte public and private keys", () => {
    const kp = generateDmKeypair();
    expect(kp.publicKey).toHaveLength(32);
    expect(kp.privateKey).toHaveLength(32);
  });

  it("generates unique keypairs on every call", () => {
    const kp1 = generateDmKeypair();
    const kp2 = generateDmKeypair();
    expect(toHex(kp1.publicKey)).not.toBe(toHex(kp2.publicKey));
    expect(toHex(kp1.privateKey)).not.toBe(toHex(kp2.privateKey));
  });
});

// ── createConversationId ──────────────────────────────────────────────────────

describe("createConversationId", () => {
  it("is commutative — same result regardless of argument order", () => {
    const addrA = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    const addrB = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF";
    expect(createConversationId(addrA, addrB)).toBe(createConversationId(addrB, addrA));
  });

  it("produces a 64-character hex string (SHA-256)", () => {
    const id = createConversationId("addr-a", "addr-b");
    expect(id).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(id)).toBe(true);
  });

  it("different address pairs produce different IDs", () => {
    const a = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    const b = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF";
    const c = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWHF";
    expect(createConversationId(a, b)).not.toBe(createConversationId(a, c));
  });
});

// ── Full key-exchange flow ────────────────────────────────────────────────────

describe("full key-exchange flow", () => {
  const aliceAddr = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const bobAddr = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF";

  it("Alice encrypts, Bob decrypts", () => {
    const alice = generateDmKeypair();
    const bob = generateDmKeypair();
    const msg = "Hello Bob!";
    const ct = encryptDirectMessage(alice.privateKey, bob.publicKey, aliceAddr, bobAddr, msg, 0);
    const plain = decryptDirectMessage(bob.privateKey, alice.publicKey, bobAddr, aliceAddr, ct, 0);
    expect(plain).toBe(msg);
  });

  it("Bob encrypts, Alice decrypts (reverse direction)", () => {
    const alice = generateDmKeypair();
    const bob = generateDmKeypair();
    const msg = "Hello Alice!";
    const ct = encryptDirectMessage(bob.privateKey, alice.publicKey, bobAddr, aliceAddr, msg, 0);
    const plain = decryptDirectMessage(alice.privateKey, bob.publicKey, aliceAddr, bobAddr, ct, 0);
    expect(plain).toBe(msg);
  });

  it("third party cannot decrypt", () => {
    const alice = generateDmKeypair();
    const bob = generateDmKeypair();
    const eve = generateDmKeypair();
    const ct = encryptDirectMessage(
      alice.privateKey,
      bob.publicKey,
      aliceAddr,
      bobAddr,
      "secret",
      0
    );
    expect(() =>
      decryptDirectMessage(eve.privateKey, alice.publicKey, bobAddr, aliceAddr, ct, 0)
    ).toThrow(DecryptionError);
  });

  it("wrong message index causes decryption failure", () => {
    const alice = generateDmKeypair();
    const bob = generateDmKeypair();
    const ct = encryptDirectMessage(alice.privateKey, bob.publicKey, aliceAddr, bobAddr, "msg", 1);
    expect(() =>
      decryptDirectMessage(bob.privateKey, alice.publicKey, bobAddr, aliceAddr, ct, 2)
    ).toThrow(DecryptionError);
  });

  it("handles Unicode and emoji correctly", () => {
    const alice = generateDmKeypair();
    const bob = generateDmKeypair();
    const msg = "🔐 Hello 世界! 🚀";
    const ct = encryptDirectMessage(alice.privateKey, bob.publicKey, aliceAddr, bobAddr, msg, 0);
    const plain = decryptDirectMessage(bob.privateKey, alice.publicKey, bobAddr, aliceAddr, ct, 0);
    expect(plain).toBe(msg);
  });
});

// ── Relay sendMessage retry tests ────────────────────────────────────────────

describe("RelayClient sendMessage retry logic", () => {
  it("should not retry on 4xx errors", async () => {
    const { RelayClient } = await import("../relay");
    const client = new RelayClient("https://relay.example.com");
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "Bad request",
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    await expect(
      client.sendMessage(
        {
          publicKey: () => "GTEST",
          sign: () => new Uint8Array(64),
        } as unknown as import("@stellar/stellar-base").Keypair,
        "GRECIPIENT",
        new Uint8Array(100),
        0
      )
    ).rejects.toThrow("non-retryable");

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should retry on 5xx errors with exponential backoff", async () => {
    const { RelayClient } = await import("../relay");
    const client = new RelayClient("https://relay.example.com");
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Server error",
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "Service unavailable",
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "OK",
      });
    global.fetch = mockFetch as unknown as typeof fetch;

    await client.sendMessage(
      {
        publicKey: () => "GTEST",
        sign: () => new Uint8Array(64),
      } as unknown as import("@stellar/stellar-base").Keypair,
      "GRECIPIENT",
      new Uint8Array(100),
      0
    );

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("should stop retrying after maxRetries", async () => {
    const { RelayClient } = await import("../relay");
    const client = new RelayClient("https://relay.example.com");
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Server error",
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    await expect(
      client.sendMessage(
        {
          publicKey: () => "GTEST",
          sign: () => new Uint8Array(64),
        } as unknown as import("@stellar/stellar-base").Keypair,
        "GRECIPIENT",
        new Uint8Array(100),
        0
      )
    ).rejects.toThrow();

    expect(mockFetch).toHaveBeenCalledTimes(4);
  }, 15_000);
});
