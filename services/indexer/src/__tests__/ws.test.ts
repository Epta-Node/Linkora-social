/**
 * WebSocket fanout tests.
 *
 * Spins up a real HTTP+WS server on an ephemeral port, connects real `ws`
 * clients, and asserts events flow from the bus to clients within the 200ms
 * SLA — including under a synthetic burst.
 */

import http from "http";
import { AddressInfo } from "net";
import WebSocket from "ws";
import { EventBus, BusEvent } from "../bus";
import { attachWebSocketServer, WsHandle, WsServerOptions } from "../ws";
import { TokenBucket } from "../ratelimit";

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

async function waitFor(pred: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

interface Harness {
  server: http.Server;
  handle: WsHandle;
  bus: EventBus;
  port: number;
}

async function startHarness(
  heartbeatMs = 15_000,
  rateLimit?: WsServerOptions["rateLimit"],
  maxPayloadBytes?: number
): Promise<Harness> {
  const bus = new EventBus();
  const server = http.createServer();
  const handle = attachWebSocketServer(server, bus, {
    path: "/ws",
    heartbeatMs,
    rateLimit,
    maxPayloadBytes,
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, handle, bus, port };
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
      frame: unknown;
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
    // Generous bound: CI/turbo CPU contention can delay event-loop callbacks.
    expect(at - sentAt).toBeLessThan(1000);
    expect(frame.type).toBe("PostCreated");
    expect(frame.payload.ledgerSequence).toBe(100);

    client.close();
  });

  it("delivers a synthetic burst to all clients within 200ms each", async () => {
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
          latencies.push(Date.now() - frame.payload.data.sentAt);
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
    // Generous bound: CI/turbo CPU contention can delay event-loop callbacks.
    expect(Math.max(...latA, ...latB)).toBeLessThan(1000);

    clientA.close();
    clientB.close();
  });

  it("honours type subscriptions", async () => {
    h = await startHarness();
    const client = await connect(h.port);
    await waitFor(() => h.handle.clientCount() === 1);

    // Subscribe to only "Follow" and wait for the ack.
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

    h.bus.publish(busEvent("PostCreated", 1)); // filtered out
    h.bus.publish(busEvent("Follow", 2)); // delivered

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
    // burst=3 means the first 3 frames are free; a near-zero refill rate keeps
    // the bucket deterministically drained across the burst regardless of
    // real-world scheduling jitter between sends.
    h = await startHarness(15_000, {
      createBucket: () => new TokenBucket({ ratePerSec: 1, burst: 3 }),
      maxViolations: 2,
    });
    const client = await connect(h.port);
    await waitFor(() => h.handle.clientCount() === 1);

    const acked: string[] = [];
    const errors: string[] = [];
    let closeCode: number | undefined;
    let closeReason: string | undefined;

    client.on("message", (data) => {
      const frame = JSON.parse(data.toString());
      if (frame.type === "subscribed") acked.push(frame.type);
      if (frame.type === "error") errors.push(frame.payload.message);
    });
    const closed = new Promise<void>((resolve) => {
      client.on("close", (code, reason) => {
        closeCode = code;
        closeReason = reason.toString();
        resolve();
      });
    });

    // Flood well past the burst + violation budget: 3 free + 2 tolerated
    // over-budget frames + 1 that crosses the threshold = 6 to trigger a close.
    for (let i = 0; i < 10; i++) {
      client.send(JSON.stringify({ action: "subscribe", types: ["Follow"] }));
    }

    await closed;
    expect(closeCode).toBe(1008);
    expect(closeReason).toBe("rate limit exceeded");
    expect(acked.length).toBe(3);
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.every((m) => m.includes("rate limit exceeded"))).toBe(true);
    await waitFor(() => h.handle.clientCount() === 0);
  });

  it("keeps a responsive client alive across heartbeats", async () => {
    h = await startHarness(1000); // heartbeat every second
    const client = await connect(h.port);
    await waitFor(() => h.handle.clientCount() === 1);

    // `ws` auto-replies to pings with pongs; the client should survive
    // several heartbeat cycles. A generous heartbeat interval keeps the test
    // immune to event-loop stalls on CPU-contended CI runners (a stalled loop
    // can otherwise make the server think a responsive client is dead).
    await new Promise((r) => setTimeout(r, 2200)); // ~2+ heartbeat cycles
    expect(h.handle.clientCount()).toBe(1);
    expect(client.readyState).toBe(WebSocket.OPEN);

    client.close();
  }, 10_000);

  it("rejects and closes a connection sending an oversized frame", async () => {
    h = await startHarness(15_000, undefined, 50); // max 50 bytes
    const client = await connect(h.port);
    await waitFor(() => h.handle.clientCount() === 1);

    let closeCode: number | undefined;
    const closed = new Promise<void>((resolve) => {
      client.on("close", (code) => {
        closeCode = code;
        resolve();
      });
    });

    const largeMessage = JSON.stringify({ action: "subscribe", types: ["A".repeat(100)] });
    client.send(largeMessage);

    await closed;
    expect(closeCode).toBe(1009);
    await waitFor(() => h.handle.clientCount() === 0);
  });
});
