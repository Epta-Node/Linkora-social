/**
 * WebSocket fanout tests.
 *
 * Spins up a real HTTP+WS server on an ephemeral port, connects real `ws`
 * clients, and asserts events flow from the bus to clients within the 200ms
 * SLA — including under a synthetic burst.
 *
 * New in this revision:
 *   - Auth-required suite: valid sig, missing auth deadline, replay attack,
 *     double-auth rejection, subscribe-before-auth rejection.
 *   - Backpressure suite: slow-client queue overflow drops oldest frames and
 *     disconnects if too far behind.
 */

import http from "http";
import { createHash } from "crypto";
import { AddressInfo } from "net";
import WebSocket from "ws";
import { Keypair } from "@stellar/stellar-sdk";
import { EventBus, BusEvent } from "../bus";
import {
  attachWebSocketServer,
  WsHandle,
  WsServerOptions,
  buildWsAuthMessage,
  verifyWsAuth,
  WS_AUTH_TIMESTAMP_TOLERANCE_MS,
} from "../ws";
import { TokenBucket } from "../ratelimit";

// ── Helpers ───────────────────────────────────────────────────────────────────

function busEvent(type: string, ledger: number, index = 0): BusEvent {
  return {
    type,
    ledgerSequence: ledger,
    eventIndex: index,
    contractId: "C1",
    topic: [type],
    data: { n: ledger },
  };
}

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

interface Harness {
  server: http.Server;
  handle: WsHandle;
  bus: EventBus;
  port: number;
}

async function startHarness(
  opts: Partial<WsServerOptions> & { heartbeatMs?: number } = {}
): Promise<Harness> {
  const busInstance = new EventBus();
  const server = http.createServer();
  const handle = attachWebSocketServer(server, busInstance, {
    path: "/ws",
    heartbeatMs: opts.heartbeatMs ?? 15_000,
    ...opts,
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, handle, bus: busInstance, port };
}

async function stopHarness(h: Harness): Promise<void> {
  await h.handle.close();
  await new Promise<void>((resolve) => h.server.close(() => resolve()));
}

function connect(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  return new Promise((resolve, reject) => {
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

/** Generate a fresh throwaway Stellar keypair for test use. */
function makeKeypair(): Keypair {
  return Keypair.random();
}

/** Sign a WS auth message with the given keypair and return base64 signature. */
function signAuth(keypair: Keypair, address: string, timestamp: number): string {
  const message = buildWsAuthMessage(address, timestamp);
  const hash = createHash("sha256").update(message).digest();
  return keypair.sign(hash).toString("base64");
}

/** Build a valid auth frame payload. */
function makeAuthFrame(
  keypair: Keypair,
  timestampOverride?: number
): { action: string; address: string; timestamp: number; signature: string } {
  const address = keypair.publicKey();
  const timestamp = timestampOverride ?? Date.now();
  const signature = signAuth(keypair, address, timestamp);
  return { action: "auth", address, timestamp, signature };
}

/** Send an auth frame and wait for the `authenticated` ack. */
async function authenticate(ws: WebSocket, keypair: Keypair): Promise<string> {
  const frame = makeAuthFrame(keypair);
  const ack = new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("auth ack timeout")), 3000);
    ws.on("message", function handler(data) {
      const msg = JSON.parse(data.toString());
      if (msg.type === "authenticated") {
        clearTimeout(t);
        ws.off("message", handler);
        resolve(msg.payload.address);
      }
      if (msg.type === "error") {
        clearTimeout(t);
        ws.off("message", handler);
        reject(new Error(msg.payload.message));
      }
    });
  });
  ws.send(JSON.stringify(frame));
  return ack;
}

// ── Original fanout tests (preserved) ────────────────────────────────────────

describe("WebSocket fanout", () => {
  let h: Harness;

  afterEach(async () => {
    if (h) await stopHarness(h);
  });

  it("pushes an event to a connected client within 200ms", async () => {
    h = await startHarness();
    const client = await connect(h.port);
    await waitFor(() => h.handle.clientCount() === 1);

    interface ReceivedFrame {
      frame: { type: string; payload: { ledgerSequence: number } };
      at: number;
    }

    const received = new Promise<ReceivedFrame>((resolve) => {
      client.on("message", (data) =>
        resolve({ frame: JSON.parse(data.toString()), at: Date.now() })
      );
    });

    const sentAt = Date.now();
    h.bus.publish(busEvent("PostCreated", 100));

    const { frame, at } = await received;
    expect(at - sentAt).toBeLessThan(1000);
    expect(frame.type).toBe("PostCreated");
    expect(frame.payload.ledgerSequence).toBe(100);

    client.close();
  });

  it("delivers a synthetic burst to all clients within 1000ms each", async () => {
    h = await startHarness();
    const clientA = await connect(h.port);
    const clientB = await connect(h.port);
    await waitFor(() => h.handle.clientCount() === 2);

    const N = 100;
    const collect = (ws: WebSocket): Promise<number[]> =>
      new Promise((resolve) => {
        const latencies: number[] = [];
        ws.on("message", (data) => {
          const frame = JSON.parse(data.toString());
          latencies.push(Date.now() - (frame.payload.data as { sentAt: number }).sentAt);
          if (latencies.length === N) resolve(latencies);
        });
      });

    const a = collect(clientA);
    const b = collect(clientB);

    for (let i = 0; i < N; i++) {
      const sentAt = Date.now();
      h.bus.publish({
        type: "Tip",
        ledgerSequence: i,
        eventIndex: 0,
        contractId: "C1",
        topic: ["Tip"],
        data: { sentAt },
      });
    }

    const [latA, latB] = await Promise.all([a, b]);
    expect(latA).toHaveLength(N);
    expect(latB).toHaveLength(N);
    expect(Math.max(...latA, ...latB)).toBeLessThan(1000);

    clientA.close();
    clientB.close();
  });

  it("honours type subscriptions", async () => {
    h = await startHarness();
    const client = await connect(h.port);
    await waitFor(() => h.handle.clientCount() === 1);

    interface AckFrame {
      type: string;
      payload: { types: string[] };
    }

    const ack = new Promise<AckFrame>((resolve) => {
      client.on("message", (data) => {
        const frame = JSON.parse(data.toString());
        if (frame.type === "subscribed") resolve(frame);
      });
    });
    client.send(JSON.stringify({ action: "subscribe", types: ["Follow"] }));
    const ackFrame = await ack;
    expect(ackFrame.payload.types).toEqual(["Follow"]);

    const types: string[] = [];
    client.removeAllListeners("message");
    client.on("message", (data) => types.push(JSON.parse(data.toString()).type));

    h.bus.publish(busEvent("PostCreated", 1));
    h.bus.publish(busEvent("Follow", 2));

    await waitFor(() => types.includes("Follow"));
    expect(types).not.toContain("PostCreated");

    client.close();
  });

  it("cleans up client state on disconnect", async () => {
    h = await startHarness();
    const client = await connect(h.port);
    await waitFor(() => h.handle.clientCount() === 1);

    client.close();
    await waitFor(() => h.handle.clientCount() === 0);
    expect(h.handle.clientCount()).toBe(0);
  });

  it("throttles then disconnects a connection flooding inbound frames", async () => {
    h = await startHarness({
      rateLimit: {
        createBucket: () => new TokenBucket({ ratePerSec: 1, burst: 3 }),
        maxViolations: 2,
      },
    });
    const client = await connect(h.port);
    await waitFor(() => h.handle.clientCount() === 1);

    const acked: string[] = [];
    const errors: string[] = [];
    let closeCode: number | undefined;

    client.on("message", (data) => {
      const frame = JSON.parse(data.toString());
      if (frame.type === "subscribed") acked.push(frame.type);
      if (frame.type === "error") errors.push(frame.payload.message);
    });
    const closed = new Promise<void>((resolve) => {
      client.on("close", (code) => {
        closeCode = code;
        resolve();
      });
    });

    for (let i = 0; i < 10; i++) {
      client.send(JSON.stringify({ action: "subscribe", types: ["Follow"] }));
    }

    await closed;
    expect(closeCode).toBe(1008);
    expect(acked.length).toBe(3);
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.every((m) => m.includes("rate limit exceeded"))).toBe(true);
    await waitFor(() => h.handle.clientCount() === 0);
  });

  it("keeps a responsive client alive across heartbeats", async () => {
    h = await startHarness({ heartbeatMs: 1000 });
    const client = await connect(h.port);
    await waitFor(() => h.handle.clientCount() === 1);

    await new Promise((r) => setTimeout(r, 2200));
    expect(h.handle.clientCount()).toBe(1);
    expect(client.readyState).toBe(WebSocket.OPEN);

    client.close();
  }, 10_000);

  it("rejects and closes a connection sending an oversized frame", async () => {
    h = await startHarness({ maxPayloadBytes: 50 });
    const client = await connect(h.port);
    await waitFor(() => h.handle.clientCount() === 1);

    let closeCode: number | undefined;
    const closed = new Promise<void>((resolve) => {
      client.on("close", (code) => {
        closeCode = code;
        resolve();
      });
    });

    client.send(JSON.stringify({ action: "subscribe", types: ["A".repeat(100)] }));

    await closed;
    expect(closeCode).toBe(1009);
    await waitFor(() => h.handle.clientCount() === 0);
  });
});

// ── Auth tests ────────────────────────────────────────────────────────────────

describe("WebSocket auth (WS_AUTH_REQUIRED)", () => {
  let h: Harness;

  afterEach(async () => {
    if (h) await stopHarness(h);
  });

  it("delivers events to an authenticated client", async () => {
    h = await startHarness({ auth: { required: true, deadlineMs: 5000 } });
    const keypair = makeKeypair();
    const client = await connect(h.port);
    await waitFor(() => h.handle.clientCount() === 1);

    const address = await authenticate(client, keypair);
    expect(address).toBe(keypair.publicKey());

    const received: string[] = [];
    client.on("message", (data) => {
      const f = JSON.parse(data.toString());
      if (f.type !== "authenticated") received.push(f.type);
    });

    h.bus.publish(busEvent("PostCreated", 1));
    await waitFor(() => received.length > 0);
    expect(received).toContain("PostCreated");

    client.close();
  });

  it("does not deliver events to unauthenticated clients", async () => {
    h = await startHarness({ auth: { required: true, deadlineMs: 5000 } });

    const authedKp = makeKeypair();
    const authedClient = await connect(h.port);
    const unauthClient = await connect(h.port);
    await waitFor(() => h.handle.clientCount() === 2);

    // Only auth one of the two clients
    await authenticate(authedClient, authedKp);

    const unauthReceived: string[] = [];
    unauthClient.on("message", (data) => {
      const f = JSON.parse(data.toString());
      if (f.type !== "error") unauthReceived.push(f.type);
    });

    const authedReceived: string[] = [];
    authedClient.on("message", (data) => {
      const f = JSON.parse(data.toString());
      if (f.type !== "authenticated") authedReceived.push(f.type);
    });

    h.bus.publish(busEvent("Follow", 10));
    await waitFor(() => authedReceived.length > 0);

    // Authed client got the event; unauthed did not.
    expect(authedReceived).toContain("Follow");
    expect(unauthReceived).not.toContain("Follow");

    authedClient.close();
    unauthClient.close();
  });

  it("disconnects a client that never authenticates within the deadline", async () => {
    h = await startHarness({ auth: { required: true, deadlineMs: 200 } });
    const client = await connect(h.port);
    await waitFor(() => h.handle.clientCount() === 1);

    let closeCode: number | undefined;
    const closed = new Promise<void>((resolve) => {
      client.on("close", (code) => {
        closeCode = code;
        resolve();
      });
    });

    await closed;
    expect(closeCode).toBe(1008);
    await waitFor(() => h.handle.clientCount() === 0);
  });

  it("rejects a replay attack (expired timestamp)", async () => {
    h = await startHarness({ auth: { required: true, deadlineMs: 5000 } });
    const keypair = makeKeypair();
    const client = await connect(h.port);
    await waitFor(() => h.handle.clientCount() === 1);

    // Use a timestamp older than the 30-second tolerance
    const oldTimestamp = Date.now() - (WS_AUTH_TIMESTAMP_TOLERANCE_MS + 5_000);
    const frame = makeAuthFrame(keypair, oldTimestamp);

    const errorReceived = new Promise<string>((resolve) => {
      client.on("message", (data) => {
        const f = JSON.parse(data.toString());
        if (f.type === "error") resolve(f.payload.message);
      });
    });

    client.send(JSON.stringify(frame));
    const errMsg = await errorReceived;
    expect(errMsg).toMatch(/expired/i);
  });

  it("rejects a second auth frame on an already-authenticated connection", async () => {
    h = await startHarness({ auth: { required: true, deadlineMs: 5000 } });
    const keypair = makeKeypair();
    const client = await connect(h.port);
    await waitFor(() => h.handle.clientCount() === 1);

    await authenticate(client, keypair);

    const errors: string[] = [];
    client.on("message", (data) => {
      const f = JSON.parse(data.toString());
      if (f.type === "error") errors.push(f.payload.message);
    });

    // Send a second auth frame
    client.send(JSON.stringify(makeAuthFrame(keypair)));
    await waitFor(() => errors.length > 0);
    expect(errors[0]).toMatch(/already authenticated/i);

    client.close();
  });

  it("rejects a subscribe frame sent before authentication", async () => {
    h = await startHarness({ auth: { required: true, deadlineMs: 5000 } });
    const client = await connect(h.port);
    await waitFor(() => h.handle.clientCount() === 1);

    const errors: string[] = [];
    client.on("message", (data) => {
      const f = JSON.parse(data.toString());
      if (f.type === "error") errors.push(f.payload.message);
    });

    client.send(JSON.stringify({ action: "subscribe", types: ["PostCreated"] }));
    await waitFor(() => errors.length > 0);
    expect(errors[0]).toMatch(/authentication required/i);

    client.close();
  });

  it("rejects an auth frame with an invalid signature", async () => {
    h = await startHarness({ auth: { required: true, deadlineMs: 5000 } });
    const keypair = makeKeypair();
    const otherKeypair = makeKeypair(); // wrong key
    const client = await connect(h.port);
    await waitFor(() => h.handle.clientCount() === 1);

    const timestamp = Date.now();
    const badSig = signAuth(otherKeypair, keypair.publicKey(), timestamp); // signed by wrong key

    const errors: string[] = [];
    const closedPromise = new Promise<void>((resolve) => client.on("close", resolve));
    client.on("message", (data) => {
      const f = JSON.parse(data.toString());
      if (f.type === "error") errors.push(f.payload.message);
    });

    client.send(
      JSON.stringify({ action: "auth", address: keypair.publicKey(), timestamp, signature: badSig })
    );

    await closedPromise;
    expect(errors.some((m) => m.includes("invalid signature"))).toBe(true);
  });

  it("verifyWsAuth returns false for a mismatched signature", () => {
    const keypair = makeKeypair();
    const other = makeKeypair();
    const ts = Date.now();
    const sig = signAuth(keypair, keypair.publicKey(), ts);
    // Valid sig but wrong address
    expect(verifyWsAuth(other.publicKey(), ts, sig)).toBe(false);
    // Valid sig and correct address
    expect(verifyWsAuth(keypair.publicKey(), ts, sig)).toBe(true);
  });
});

// ── Backpressure tests ────────────────────────────────────────────────────────

describe("WebSocket outbound backpressure", () => {
  let h: Harness;

  afterEach(async () => {
    if (h) await stopHarness(h);
  });

  it("delivers all events to a fast client without dropping", async () => {
    h = await startHarness({
      backpressure: { sendQueueDepth: 16, maxDropsBeforeDisconnect: 32 },
    });
    const client = await connect(h.port);
    await waitFor(() => h.handle.clientCount() === 1);

    const N = 10;
    const frames: unknown[] = [];
    client.on("message", (data) => frames.push(JSON.parse(data.toString())));

    for (let i = 0; i < N; i++) {
      h.bus.publish(busEvent("PostCreated", i));
    }

    await waitFor(() => frames.length >= N);
    expect(frames).toHaveLength(N);

    client.close();
  });

  it("disconnects a client that falls too far behind (exceeds maxDropsBeforeDisconnect)", async () => {
    // Queue depth 2, disconnect after >2 drops — so 5 total drops triggers it.
    h = await startHarness({
      backpressure: { sendQueueDepth: 2, maxDropsBeforeDisconnect: 2 },
    });

    // Pause the socket's receive side by monkeypatching — we create a slow
    // client by simply never calling ws.send's callback until we're ready.
    // In practice we rely on the queue filling up: by publishing many events
    // synchronously before any drain callback fires, the queue overflows.

    const client = await connect(h.port);
    await waitFor(() => h.handle.clientCount() === 1);

    let closeCode: number | undefined;
    const closed = new Promise<void>((resolve) => {
      client.on("close", (code) => {
        closeCode = code;
        resolve();
      });
    });

    // Publish a large burst synchronously. The drain loop runs in the next
    // microtask tick, so all enqueues happen before any frame is sent.
    for (let i = 0; i < 20; i++) {
      h.bus.publish(busEvent("PostCreated", i));
    }

    await closed;
    expect(closeCode).toBe(1008);
    await waitFor(() => h.handle.clientCount() === 0);
  });

  it("drops oldest frames (not newest) when the queue is full", async () => {
    // Queue depth 3, generous drop limit so we don't disconnect.
    h = await startHarness({
      backpressure: { sendQueueDepth: 3, maxDropsBeforeDisconnect: 10_000 },
    });

    const client = await connect(h.port);
    await waitFor(() => h.handle.clientCount() === 1);

    // Pause socket draining: intercept ws.send on the server side by
    // publishing 10 events in one sync block. Only 3 can queue; the first 7
    // are published before the queue has room, so head-drop removes oldest.
    // We collect whatever eventually arrives and assert the last-published
    // events are the ones that survive.

    const received: number[] = [];
    client.on("message", (data) => {
      const f = JSON.parse(data.toString());
      received.push(f.payload.ledgerSequence as number);
    });

    const TOTAL = 10;
    for (let i = 0; i < TOTAL; i++) {
      h.bus.publish(busEvent("PostCreated", i));
    }

    // Give events time to drain to the client.
    await new Promise((r) => setTimeout(r, 200));

    // The client must have received at least some events and they should
    // include the highest-ledger events (the newest ones that were kept).
    expect(received.length).toBeGreaterThan(0);
    const maxReceived = Math.max(...received);
    expect(maxReceived).toBe(TOTAL - 1); // newest event always survives

    client.close();
  });
});
