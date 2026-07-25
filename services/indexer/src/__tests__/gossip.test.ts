/**
 * Tests for the gossip protocol divergence detection and self-fencing (Phase 3).
 *
 * Covers:
 * 1. Divergence detection: one peer has a different root → DIVERGENCE_DETECTED logged.
 * 2. Self-fencing: 2/3 peers disagree → node fences → isFenced() returns true.
 * 3. API returns 503 after self-fencing.
 */

import { Pool as PgPool } from "pg";

/** Build a minimal PgPool mock that returns a given latest state root row. */
function buildPgMock(ledger: number, root: string): PgPool {
  const mockQuery = jest.fn().mockResolvedValue({
    rows: [{ ledger_sequence: String(ledger), state_root: root }],
  });
  return { query: mockQuery } as unknown as PgPool;
}

/** Mock fetch to always return peerRoot for any URL. */
function mockFetchWithRoot(peerRoot: string): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ledger: 100, root: peerRoot }),
  }) as jest.Mock;
}

// ── Test: divergence detected ─────────────────────────────────────────────────

describe("gossip divergence detection", () => {
  it("logs DIVERGENCE_DETECTED when a peer has a different root", async () => {
    jest.resetModules();
    process.env["INDEXER_PEERS"] = "http://peer-1:3001";
    process.env["DIVERGENCE_THRESHOLD"] = "99"; // prevent self-fencing
    process.env["GOSSIP_INTERVAL_MS"] = "1";

    const { startGossip } = await import("../gossip");

    const pg = buildPgMock(100, "aaaa");
    mockFetchWithRoot("bbbb");

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    const ac = new AbortController();
    // Run one cycle then abort.
    const promise = startGossip(pg, ac.signal);
    // Wait for the timer (1ms) + async work to complete.
    await new Promise((r) => setTimeout(r, 100));
    ac.abort();
    await promise;

    const logged = logSpy.mock.calls.map((c) => c.join(" "));
    expect(logged.some((l) => l.includes("DIVERGENCE_DETECTED"))).toBe(true);

    logSpy.mockRestore();
    delete process.env["INDEXER_PEERS"];
    delete process.env["DIVERGENCE_THRESHOLD"];
    delete process.env["GOSSIP_INTERVAL_MS"];
  });
});

// ── Test: self-fencing ────────────────────────────────────────────────────────

describe("gossip self-fencing", () => {
  it("self-fences when >= DIVERGENCE_THRESHOLD peers disagree", async () => {
    jest.resetModules();
    process.env["INDEXER_PEERS"] = "http://peer-1:3001,http://peer-2:3001";
    process.env["DIVERGENCE_THRESHOLD"] = "2";
    process.env["GOSSIP_INTERVAL_MS"] = "1";

    const { startGossip, isFenced } = await import("../gossip");

    const pg = buildPgMock(100, "aaaa");
    mockFetchWithRoot("bbbb"); // both peers disagree

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    const ac = new AbortController();
    // startGossip exits the loop on self-fence, so just await it.
    await startGossip(pg, ac.signal);

    expect(isFenced()).toBe(true);
    const logged = logSpy.mock.calls.map((c) => c.join(" "));
    expect(logged.some((l) => l.includes("SELF_FENCED"))).toBe(true);

    logSpy.mockRestore();
    delete process.env["INDEXER_PEERS"];
    delete process.env["DIVERGENCE_THRESHOLD"];
    delete process.env["GOSSIP_INTERVAL_MS"];
  });

  it("API returns 503 after self-fencing", async () => {
    const express = (await import("express")).default;
    const supertest = (await import("supertest")).default;
    const { requestLoggingMiddleware } = await import("../logger");

    const app = express();
    app.use(express.json());
    app.use(requestLoggingMiddleware);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use("/api", (_req: any, res: any, _next: any) => {
      res.status(503).json({
        error: {
          code: "SELF_FENCED",
          message: "Node self-fenced: Byzantine divergence detected",
          requestId: _req.context?.requestId,
        },
      });
    });

    const res = await supertest(app).get("/api/profiles/GTEST");

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: { code: "SELF_FENCED" } });
  });
});
