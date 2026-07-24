import { ConnectionHealthMonitor, ConnectionStatus } from "../health";

const mockGetLatestLedger = jest.fn();

jest.mock("@stellar/stellar-sdk/rpc", () => ({
  Server: jest.fn().mockImplementation(() => ({ getLatestLedger: mockGetLatestLedger })),
  Api: {
    isSimulationError: (r: unknown) => !!(r as { error?: unknown }).error,
    isSimulationSuccess: (r: unknown) => !!(r as { result?: unknown }).result,
  },
}));

jest.mock("@stellar/stellar-base", () => ({
  Contract: jest.fn(() => ({ call: jest.fn() })),
  nativeToScVal: jest.fn((v: unknown) => v),
  scValToNative: jest.fn((v: unknown) => v),
  TransactionBuilder: jest.fn(() => ({
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnValue({
      toEnvelope: jest.fn().mockReturnValue({ toXDR: jest.fn().mockReturnValue("AAAA") }),
    }),
  })),
  Account: jest.fn(),
  Keypair: { random: jest.fn(() => ({ publicKey: () => "GDUMMY" })) },
  StrKey: { isValidEd25519PublicKey: jest.fn(() => true) },
  xdr: {},
}));

/** Wait for a condition to become true, polling every 10ms. */
function waitFor(condition: () => boolean, timeoutMs = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      if (condition()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timeout"));
      setTimeout(poll, 10);
    };
    poll();
  });
}

describe("ConnectionHealthMonitor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("healthCheck()", () => {
    it("returns true when RPC responds", async () => {
      mockGetLatestLedger.mockResolvedValue({ sequence: 100 });
      const monitor = new ConnectionHealthMonitor("https://rpc.example.com");
      expect(await monitor.healthCheck()).toBe(true);
    });

    it("returns false when RPC throws", async () => {
      mockGetLatestLedger.mockRejectedValue(new Error("Network error"));
      const monitor = new ConnectionHealthMonitor("https://rpc.example.com");
      expect(await monitor.healthCheck()).toBe(false);
    });
  });

  describe("retry metrics", () => {
    const info = (over: Partial<import("../utils/retry").RetryAttemptInfo>) => ({
      attempt: 1,
      maxAttempts: 5,
      delayMs: 100,
      reason: "error" as const,
      error: new Error("x"),
      ...over,
    });

    it("starts healthy with zeroed counters", () => {
      const monitor = new ConnectionHealthMonitor("https://rpc.example.com");
      const m = monitor.getRetryMetrics();
      expect(m).toMatchObject({
        totalRetries: 0,
        rateLimitedRetries: 0,
        circuitOpenEvents: 0,
        exhaustedEvents: 0,
        healthy: true,
      });
    });

    it("tallies retries by reason", () => {
      const monitor = new ConnectionHealthMonitor("https://rpc.example.com");
      monitor.recordRetry(info({ reason: "error" }));
      monitor.recordRetry(info({ reason: "rate-limited", delayMs: 2000 }));
      monitor.recordRetry(info({ reason: "exhausted", delayMs: 0 }));
      const m = monitor.getRetryMetrics();
      expect(m.totalRetries).toBe(2); // error + rate-limited
      expect(m.rateLimitedRetries).toBe(1);
      expect(m.exhaustedEvents).toBe(1);
      expect(m.lastReason).toBe("exhausted");
    });

    it("goes unhealthy when the circuit opens and recovers on reset", () => {
      const monitor = new ConnectionHealthMonitor("https://rpc.example.com");
      monitor.recordRetry(info({ reason: "circuit-open", delayMs: 0 }));
      const m = monitor.getRetryMetrics();
      expect(m.circuitOpenEvents).toBe(1);
      expect(m.healthy).toBe(false);

      monitor.resetRetryMetrics();
      expect(monitor.getRetryMetrics().healthy).toBe(true);
      expect(monitor.getRetryMetrics().circuitOpenEvents).toBe(0);
    });
  });

  describe("periodic checks and status events", () => {
    it("emits 'connected' when RPC comes online", async () => {
      mockGetLatestLedger.mockResolvedValue({ sequence: 1 });
      const monitor = new ConnectionHealthMonitor("https://rpc.example.com", { intervalMs: 50 });
      const cb = jest.fn();
      monitor.onConnectionStatusChange(cb);

      await waitFor(() => cb.mock.calls.length > 0);
      expect(cb).toHaveBeenCalledWith("connected");
      monitor.stop();
    });

    it("emits 'disconnected' when RPC is unreachable", async () => {
      mockGetLatestLedger.mockRejectedValue(new Error("timeout"));
      const monitor = new ConnectionHealthMonitor("https://rpc.example.com", {
        intervalMs: 50,
        backoffMs: 50,
      });
      const cb = jest.fn();
      monitor.onConnectionStatusChange(cb);

      await waitFor(() => cb.mock.calls.length > 0);
      expect(cb).toHaveBeenCalledWith("disconnected");
      monitor.stop();
    });

    it("does not re-emit when status stays the same", async () => {
      mockGetLatestLedger.mockResolvedValue({ sequence: 1 });
      const monitor = new ConnectionHealthMonitor("https://rpc.example.com", { intervalMs: 30 });
      const cb = jest.fn();
      monitor.onConnectionStatusChange(cb);

      // Wait for first emit, then wait for 2 more intervals — should still be just 1 call
      await waitFor(() => cb.mock.calls.length > 0);
      await new Promise((r) => setTimeout(r, 80));
      expect(cb).toHaveBeenCalledTimes(1);
      monitor.stop();
    });

    it("emits 'disconnected' then 'connected' on recovery", async () => {
      let callCount = 0;
      mockGetLatestLedger.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error("down"));
        return Promise.resolve({ sequence: 5 });
      });

      const monitor = new ConnectionHealthMonitor("https://rpc.example.com", {
        backoffMs: 30,
        maxBackoffMs: 30,
        intervalMs: 50,
      });
      const statuses: ConnectionStatus[] = [];
      monitor.onConnectionStatusChange((s) => statuses.push(s));

      await waitFor(() => statuses.includes("disconnected"));
      await waitFor(() => statuses.includes("connected"));

      expect(statuses).toEqual(["disconnected", "connected"]);
      monitor.stop();
    });
  });

  describe("stop()", () => {
    it("stops further checks after stop() is called", async () => {
      mockGetLatestLedger.mockResolvedValue({ sequence: 1 });
      const monitor = new ConnectionHealthMonitor("https://rpc.example.com", { intervalMs: 20 });
      monitor.start();
      monitor.stop();

      const callsBefore = mockGetLatestLedger.mock.calls.length;
      await new Promise((r) => setTimeout(r, 60));
      expect(mockGetLatestLedger.mock.calls.length).toBe(callsBefore);
    });
  });

  describe("LinkoraClient integration", () => {
    let LinkoraClient: typeof import("../client").LinkoraClient;
    beforeAll(async () => {
      ({ LinkoraClient } = await import("../client"));
    });

    it("healthCheck() returns true on healthy RPC", async () => {
      mockGetLatestLedger.mockResolvedValue({ sequence: 1 });
      const client = new LinkoraClient({ contractId: "CDUMMY", rpcUrl: "https://rpc.example.com" });
      expect(await client.healthCheck()).toBe(true);
    });

    it("healthCheck() returns false when RPC is down", async () => {
      mockGetLatestLedger.mockRejectedValue(new Error("down"));
      const client = new LinkoraClient({ contractId: "CDUMMY", rpcUrl: "https://rpc.example.com" });
      expect(await client.healthCheck()).toBe(false);
    });

    it("onConnectionStatusChange starts checks and fires callback", async () => {
      mockGetLatestLedger.mockResolvedValue({ sequence: 1 });
      const client = new LinkoraClient({
        contractId: "CDUMMY",
        rpcUrl: "https://rpc.example.com",
        healthCheck: { intervalMs: 50 },
      });

      const cb = jest.fn();
      client.onConnectionStatusChange(cb);

      await waitFor(() => cb.mock.calls.length > 0);
      expect(cb).toHaveBeenCalledWith("connected");
      client.stopHealthChecks();
    });
  });
});
