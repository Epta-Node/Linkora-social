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
    ...overrides,
  } as unknown as Database;
}

async function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const authService = new AuthService(30);
  const database = fakeDatabase();

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
    const signature = AuthService.createAuthSignature(senderKp, recipient, 0, timestamp, ciphertext_b64);

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
    const signature = AuthService.createAuthSignature(senderKp, recipient, 0, timestamp, ciphertext_b64);

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

  it("does not require auth for GET /messages/conversation/:conversationId", async () => {
    const conversationId = "a".repeat(64);
    const res = await fetch(`${url}/api/messages/conversation/${conversationId}`);
    expect(res.status).not.toBe(401);
  });

  it("health endpoints require no auth at all", async () => {
    const res = await fetch(`${url}/health/live`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("alive");
  });
});
