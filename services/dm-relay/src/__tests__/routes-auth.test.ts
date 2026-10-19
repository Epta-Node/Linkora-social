/**
 * Route-scoped auth tests.
 *
 * Verifies that address-ownership / message-signature auth is applied only
 * to the routes that need it (POST /messages, GET /messages/:address) and
 * never to unrelated routes such as health checks — regardless of how the
 * router happens to be mounted.
 */

import http from "http";
import express from "express";
import { Keypair } from "@stellar/stellar-sdk";
import { createRouter } from "../routes";
import { createHealthRouter } from "../routes/health";
import { AuthService } from "../auth";
import { Database } from "../database";

function fakeDatabase(overrides: Partial<Database> = {}): Database {
  return {
    getMessages: jest.fn().mockResolvedValue([]),
    getMessagesByRecipient: jest.fn().mockResolvedValue([]),
    insertMessage: jest.fn().mockResolvedValue("msg-1"),
    ping: jest.fn().mockResolvedValue(undefined),
    claimIdempotencyKey: jest.fn().mockResolvedValue({ status: "claimed" }),
    completeIdempotencyKey: jest.fn().mockResolvedValue(undefined),
    getIdempotencyResponse: jest.fn().mockResolvedValue(null),
    isConversationParticipant: jest.fn().mockResolvedValue(false),
    getPoolHealth: jest.fn().mockResolvedValue({
      status: "healthy",
      latencyMs: 1,
      metrics: { totalCount: 1, idleCount: 1, waitingCount: 0 },
    }),
    ...overrides,
  } as unknown as Database;
}

async function startServer(
  database: Database = fakeDatabase()
): Promise<{ url: string; close: () => Promise<void> }> {
  const authService = new AuthService(30);

  const app = express();
  app.use(express.json());
  app.use("/api", createRouter(database, authService));
  app.use(
    createHealthRouter({
      db: database,
      startTime: Date.now(),
      isStarted: () => true,
      startedAt: () => new Date().toISOString(),
      isShuttingDown: () => false,
    })
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("route-scoped auth", () => {
  let url: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ url, close } = await startServer());
  });

  afterEach(async () => {
    await close();
  });

  it("rejects GET /messages/:address without an Authorization header", async () => {
    const address = Keypair.random().publicKey();
    const res = await fetch(`${url}/api/messages/${address}`);
    expect(res.status).toBe(401);
  });

  it("rejects POST /messages without an Authorization-verifiable signature", async () => {
    const sender = Keypair.random().publicKey();
    const recipient = Keypair.random().publicKey();
    const res = await fetch(`${url}/api/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender,
        recipient,
        ciphertext_b64: "AAAA",
        message_index: 0,
        timestamp: Math.floor(Date.now() / 1000),
        signature: "00".repeat(64),
      }),
    });
    expect(res.status).toBe(401);
  });

  it("accepts a correctly signed envelope", async () => {
    const senderKp = Keypair.random();
    const recipient = Keypair.random().publicKey();
    const ciphertext_b64 = Buffer.from("sealed payload").toString("base64");
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = AuthService.createAuthSignature(
      senderKp,
      recipient,
      0,
      timestamp,
      ciphertext_b64
    );

    const res = await fetch(`${url}/api/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Idempotency-Key": "11111111-2222-4333-8444-555555555555",
      },
      body: JSON.stringify({
        sender: senderKp.publicKey(),
        recipient,
        ciphertext_b64,
        message_index: 0,
        timestamp,
        signature,
      }),
    });
    expect(res.status).toBe(201);
  });

  it("rejects a valid signature replayed with substituted ciphertext (401)", async () => {
    const senderKp = Keypair.random();
    const recipient = Keypair.random().publicKey();
    const ciphertext_b64 = Buffer.from("sealed payload").toString("base64");
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = AuthService.createAuthSignature(
      senderKp,
      recipient,
      0,
      timestamp,
      ciphertext_b64
    );

    // The signature is authentic and covers `ciphertext_b64`; the ciphertext is
    // then swapped for attacker-chosen bytes on the way to the relay.
    const res = await fetch(`${url}/api/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: senderKp.publicKey(),
        recipient,
        ciphertext_b64: Buffer.from("attacker payload").toString("base64"),
        message_index: 0,
        timestamp,
        signature,
      }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects GET /messages/conversation/:conversationId without an Authorization header (#1331)", async () => {
    const conversationId = "a".repeat(64);
    const res = await fetch(`${url}/api/messages/conversation/${conversationId}`);
    expect(res.status).toBe(401);
  });

  it("health endpoints require no auth at all", async () => {
    const res = await fetch(`${url}/health/live`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("alive");
  });
});

describe("GET /messages/conversation/:conversationId requires participant auth (#1331)", () => {
  it("rejects a request with no Authorization header", async () => {
    const database = fakeDatabase();
    const { url, close } = await startServer(database);
    try {
      const conversationId = "a".repeat(64);
      const res = await fetch(`${url}/api/messages/conversation/${conversationId}`);
      expect(res.status).toBe(401);
      expect(database.isConversationParticipant).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("rejects an authenticated caller who is not a participant of the conversation", async () => {
    const database = fakeDatabase({
      isConversationParticipant: jest.fn().mockResolvedValue(false),
    });
    const { url, close } = await startServer(database);
    try {
      const stranger = Keypair.random();
      const conversationId = "b".repeat(64);
      const res = await fetch(`${url}/api/messages/conversation/${conversationId}`, {
        headers: { Authorization: AuthService.createAuthHeader(stranger) },
      });
      expect(res.status).toBe(403);
      expect(database.isConversationParticipant).toHaveBeenCalledWith(
        conversationId,
        stranger.publicKey()
      );
    } finally {
      await close();
    }
  });

  it("accepts an authenticated participant of the conversation", async () => {
    const database = fakeDatabase({ isConversationParticipant: jest.fn().mockResolvedValue(true) });
    const { url, close } = await startServer(database);
    try {
      const participant = Keypair.random();
      const conversationId = "c".repeat(64);
      const res = await fetch(`${url}/api/messages/conversation/${conversationId}`, {
        headers: { Authorization: AuthService.createAuthHeader(participant) },
      });
      expect(res.status).toBe(200);
      expect(database.isConversationParticipant).toHaveBeenCalledWith(
        conversationId,
        participant.publicKey()
      );
    } finally {
      await close();
    }
  });

  it("rejects a forged signature the same way as the other authenticated routes", async () => {
    const database = fakeDatabase();
    const { url, close } = await startServer(database);
    try {
      const address = Keypair.random().publicKey();
      const timestamp = Math.floor(Date.now() / 1000);
      const conversationId = "d".repeat(64);
      const res = await fetch(`${url}/api/messages/conversation/${conversationId}`, {
        headers: { Authorization: `Stellar ${address} ${"00".repeat(64)} ${timestamp}` },
      });
      expect(res.status).toBe(401);
      expect(database.isConversationParticipant).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("never leaks conversation membership before verifying the signature (auth precedes the DB check)", async () => {
    // A stranger who can forge neither the signature nor knowledge of
    // membership gets 401, not 403 — the DB is never consulted for an
    // unauthenticated caller, so no information about the conversation
    // (not even "these are/aren't the right addresses") is revealed.
    const database = fakeDatabase({ isConversationParticipant: jest.fn().mockResolvedValue(true) });
    const { url, close } = await startServer(database);
    try {
      const conversationId = "e".repeat(64);
      const res = await fetch(`${url}/api/messages/conversation/${conversationId}`);
      expect(res.status).toBe(401);
      expect(database.isConversationParticipant).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});
