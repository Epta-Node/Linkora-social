/**
 * Tests for the connected-client shutdown path (issue #1526).
 *
 * `wss.close()` alone never terminates established sockets, so the old
 * shutdown order stalled for the full drain timeout and exited 1 whenever at
 * least one WebSocket client was connected. These tests exercise the fix:
 *
 *  - a live client receives close code 1001 (Going Away),
 *  - shutdown still completes in well under two seconds,
 *  - the no-clients case resolves immediately.
 */

import http from "http";
import { AddressInfo } from "net";
import { WebSocket, WebSocketServer } from "ws";
import { shutdownWebSocketServer, SHUTDOWN_CLOSE_CODE } from "../ws-shutdown";

interface Harness {
  server: http.Server;
  wss: WebSocketServer;
  port: number;
}

function startHarness(): Promise<Harness> {
  return new Promise((resolve) => {
    const server = http.createServer();
    const wss = new WebSocketServer({ server, path: "/ws" });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, wss, port: (server.address() as AddressInfo).port });
    });
  });
}

function stopHarness({ server, wss }: Harness): Promise<void> {
  return new Promise((resolve) => {
    for (const client of wss.clients) client.terminate();
    try {
      wss.close();
    } catch {
      // Already closed by the shutdown under test.
    }
    server.closeAllConnections?.();
    server.close(() => resolve());
    // Safety net in case close() never reports (no open handles expected).
    setTimeout(resolve, 1_000).unref();
  });
}

function connectClient(port: number): Promise<{ socket: WebSocket; closed: Promise<number> }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const closed = new Promise<number>((res) => socket.on("close", (code) => res(code)));
    socket.on("open", () => resolve({ socket, closed }));
    socket.on("error", reject);
  });
}

describe("shutdownWebSocketServer with live clients", () => {
  it("sends close code 1001 and completes in well under two seconds", async () => {
    const harness = await startHarness();
    const { closed } = await connectClient(harness.port);
    expect(harness.wss.clients.size).toBe(1);

    const startedAt = Date.now();
    await shutdownWebSocketServer(harness.wss, 500);
    const elapsedMs = Date.now() - startedAt;

    const closeCode = await closed;

    expect(closeCode).toBe(SHUTDOWN_CLOSE_CODE);
    expect(closeCode).toBe(1001);
    expect(elapsedMs).toBeLessThan(2000);

    await stopHarness(harness);
  });

  it("drains several concurrent clients", async () => {
    const harness = await startHarness();
    const clients = await Promise.all([
      connectClient(harness.port),
      connectClient(harness.port),
      connectClient(harness.port),
    ]);
    expect(harness.wss.clients.size).toBe(3);

    const startedAt = Date.now();
    await shutdownWebSocketServer(harness.wss, 500);
    const elapsedMs = Date.now() - startedAt;

    const codes = await Promise.all(clients.map((c) => c.closed));
    expect(codes).toEqual([1001, 1001, 1001]);
    expect(elapsedMs).toBeLessThan(2000);

    await stopHarness(harness);
  });

  it("resolves immediately when no client is connected", async () => {
    const harness = await startHarness();

    const startedAt = Date.now();
    await shutdownWebSocketServer(harness.wss, 500);

    expect(Date.now() - startedAt).toBeLessThan(2000);

    await stopHarness(harness);
  });

  it("terminates clients that never complete the close handshake", async () => {
    const harness = await startHarness();
    const { socket, closed } = await connectClient(harness.port);

    // A zero grace period forces the terminate fallback on the next tick.
    await shutdownWebSocketServer(harness.wss, 0);

    await expect(closed).resolves.toBeDefined();
    expect(socket.readyState).toBe(WebSocket.CLOSED);

    await stopHarness(harness);
  });
});
