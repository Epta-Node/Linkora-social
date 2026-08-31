import http from "http";
import { Pool } from "pg";
import { GracefulShutdown } from "../graceful-shutdown";
import { WsHandle } from "../ws";
import { WebSocketServer } from "ws";
import request from "supertest";
import { createApp } from "../api";
import { Database } from "../db";
import { HealthMonitor } from "../services/health-monitor";

function mockPool(): Pool {
  return { end: jest.fn().mockResolvedValue(undefined) } as unknown as Pool;
}

function mockWsHandle(): WsHandle {
  return {
    wss: {} as WebSocketServer,
    clientCount: jest.fn().mockReturnValue(0),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

function mockAbortController(): AbortController {
  return { abort: jest.fn() } as unknown as AbortController;
}

function mockDb(): Database {
  return {} as Database;
}

describe("GracefulShutdown", () => {
  let httpServer: http.Server;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    httpServer = http.createServer();
    originalExit = process.exit;
    process.exit = jest.fn() as unknown as typeof process.exit;
  });

  afterEach(() => {
    httpServer.close();
    process.exit = originalExit;
  });

  it("sets isShuttingDown and fires onSignal on shutdown", async () => {
    const pgPool = mockPool();
    const wsHandle = mockWsHandle();
    const abortController = mockAbortController();
    const scoreRefreshStop = jest.fn();
    const detachDispatcher = jest.fn();
    const onSignal = jest.fn();
    const shutdownFlag = { active: false };

    const gs = new GracefulShutdown({
      httpServer,
      pgPool,
      wsHandle,
      abortController,
      scoreRefreshStop,
      detachNotificationDispatcher: detachDispatcher,
      shutdownFlag,
      onSignal,
    });

    expect(gs.isShuttingDown).toBe(false);
    expect(shutdownFlag.active).toBe(false);

    await gs.shutdown("SIGTERM");

    expect(gs.isShuttingDown).toBe(true);
    expect(shutdownFlag.active).toBe(true);
    expect(onSignal).toHaveBeenCalledWith("SIGTERM");
    expect(scoreRefreshStop).toHaveBeenCalled();
    expect(detachDispatcher).toHaveBeenCalled();
    expect(abortController.abort).toHaveBeenCalled();
    expect(wsHandle.close).toHaveBeenCalled();
  });

  it("is idempotent — second shutdown call is a no-op", async () => {
    const pgPool = mockPool();
    const wsHandle = mockWsHandle();
    const abortController = mockAbortController();
    const scoreRefreshStop = jest.fn();
    const detachDispatcher = jest.fn();
    const onSignal = jest.fn();

    const gs = new GracefulShutdown({
      httpServer,
      pgPool,
      wsHandle,
      abortController,
      scoreRefreshStop,
      detachNotificationDispatcher: detachDispatcher,
      onSignal,
    });

    await gs.shutdown("SIGTERM");
    await gs.shutdown("SIGINT");

    expect(onSignal).toHaveBeenCalledTimes(1);
    expect(scoreRefreshStop).toHaveBeenCalledTimes(1);
    expect(detachDispatcher).toHaveBeenCalledTimes(1);
    expect(abortController.abort).toHaveBeenCalledTimes(1);
  });

  it("drains in-flight requests before closing pg pool", async () => {
    const pgPool = mockPool();
    const wsHandle = mockWsHandle();
    const abortController = mockAbortController();
    const scoreRefreshStop = jest.fn();
    const detachDispatcher = jest.fn();

    const gs = new GracefulShutdown({
      httpServer,
      pgPool,
      wsHandle,
      abortController,
      scoreRefreshStop,
      detachNotificationDispatcher: detachDispatcher,
    });

    const req = new http.IncomingMessage(httpServer);
    const res = new http.ServerResponse(req);
    httpServer.emit("request", req, res);

    expect(gs.activeRequestCount).toBe(1);

    const shutdownPromise = gs.shutdown("SIGTERM");
    await new Promise(process.nextTick);

    expect(pgPool.end).not.toHaveBeenCalled();

    res.emit("finish");
    await shutdownPromise;

    expect(pgPool.end).toHaveBeenCalled();
  });

  it("times out if requests do not drain", async () => {
    const pgPool = mockPool();
    const wsHandle = mockWsHandle();
    const abortController = mockAbortController();
    const scoreRefreshStop = jest.fn();
    const detachDispatcher = jest.fn();

    const gs = new GracefulShutdown({
      httpServer,
      pgPool,
      wsHandle,
      abortController,
      scoreRefreshStop,
      detachNotificationDispatcher: detachDispatcher,
      shutdownTimeoutMs: 50,
    });

    const req = new http.IncomingMessage(httpServer);
    const res = new http.ServerResponse(req);
    httpServer.emit("request", req, res);

    await gs.shutdown("SIGTERM");

    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("registers signal handlers", () => {
    const pgPool = mockPool();
    const wsHandle = mockWsHandle();
    const abortController = mockAbortController();

    const onSigTerm = jest.spyOn(process, "on").mockImplementation(() => process);
    const gs = new GracefulShutdown({
      httpServer,
      pgPool,
      wsHandle,
      abortController,
      scoreRefreshStop: jest.fn(),
      detachNotificationDispatcher: jest.fn(),
    });

    gs.registerSignals();

    expect(onSigTerm).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    expect(onSigTerm).toHaveBeenCalledWith("SIGINT", expect.any(Function));

    onSigTerm.mockRestore();
  });

  it("accepts custom shutdown timeout", () => {
    const pgPool = mockPool();
    const wsHandle = mockWsHandle();
    const abortController = mockAbortController();

    const gs = new GracefulShutdown({
      httpServer,
      pgPool,
      wsHandle,
      abortController,
      scoreRefreshStop: jest.fn(),
      detachNotificationDispatcher: jest.fn(),
      shutdownTimeoutMs: 15000,
    });

    expect(gs).toBeDefined();
  });
});

describe("createApp shutdown middleware", () => {
  function mockMonitor(ready = true): HealthMonitor {
    return {
      checkReadiness: jest.fn().mockResolvedValue({
        ready,
        checks: undefined,
      }),
    } as unknown as HealthMonitor;
  }

  it("rejects new requests with 503 during shutdown", async () => {
    const shutdownFlag = { active: false };
    const app = createApp(mockDb(), undefined, mockMonitor(true), shutdownFlag);

    const res1 = await request(app).get("/health/ready");
    expect(res1.status).toBe(200);

    shutdownFlag.active = true;

    const res2 = await request(app).get("/health/ready");
    expect(res2.status).toBe(503);
    expect(res2.body).toMatchObject({ error: "Service shutting down", code: "SHUTTING_DOWN" });
  });

  it("returns 503 on /health during shutdown", async () => {
    const shutdownFlag = { active: true };
    const app = createApp(mockDb(), undefined, mockMonitor(true), shutdownFlag);

    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: "Service shutting down", code: "SHUTTING_DOWN" });
  });

  it("returns 503 on /health/live during shutdown", async () => {
    const shutdownFlag = { active: true };
    const app = createApp(mockDb(), undefined, mockMonitor(true), shutdownFlag);

    const res = await request(app).get("/health/live");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: "Service shutting down", code: "SHUTTING_DOWN" });
  });

  it("rejects API routes with 503 during shutdown", async () => {
    const shutdownFlag = { active: true };
    const app = createApp(mockDb(), undefined, mockMonitor(true), shutdownFlag);

    const res = await request(app).get("/api/profiles/test");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: "Service shutting down", code: "SHUTTING_DOWN" });
  });
});
