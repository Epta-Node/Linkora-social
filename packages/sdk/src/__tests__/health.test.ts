import { ConnectionHealthMonitor, ConnectionStatus } from "../health";
import * as rpc from "@stellar/stellar-sdk/rpc";

const mockGetLatestLedger = jest.fn();
const mockGetNetwork = jest.fn();

jest.mock("@stellar/stellar-sdk/rpc", () => ({
  Server: jest.fn().mockImplementation(() => ({
    getLatestLedger: mockGetLatestLedger,
    getNetwork: mockGetNetwork,
  })),
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
function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
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
    mockGetNetwork.mockResolvedValue({ passphrase: "Test SDF Network ; September 2015" });
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

    it("rejects an RPC that reports a different network passphrase", async () => {
      mockGetNetwork.mockResolvedValue({
        passphrase: "Public Global Stellar Network ; September 2015",
      });
      mockGetLatestLedger.mockResolvedValue({ sequence: 100 });
      const monitor = new ConnectionHealthMonitor("https://rpc.example.com");

      expect(await monitor.healthCheck()).toBe(false);
      await expect(monitor.getHealthResult()).resolves.toMatchObject({
        healthy: false,
        expectedNetworkPassphrase: "Test SDF Network ; September 2015",
        networkPassphrase: "Public Global Stellar Network ; September 2015",
      });
      expect(mockGetLatestLedger).not.toHaveBeenCalled();
    });

    it("rejects a malformed latest-ledger sequence", async () => {
      mockGetLatestLedger.mockResolvedValue({ sequence: Number.NaN });
      const monitor = new ConnectionHealthMonitor("https://rpc.example.com");

      await expect(monitor.getHealthResult()).resolves.toMatchObject({
        healthy: false,
        error: "RPC returned an invalid latest ledger sequence.",
      });
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

  describe("destroy()", () => {
    it("stops all checks and clears listeners", async () => {
      mockGetLatestLedger.mockResolvedValue({ sequence: 1 });
      const monitor = new ConnectionHealthMonitor("https://rpc.example.com", { intervalMs: 20 });
      const cb1 = jest.fn();
      const cb2 = jest.fn();
      monitor.onConnectionStatusChange(cb1);
      monitor.onConnectionStatusChange(cb2);

      await waitFor(() => cb1.mock.calls.length > 0);

      monitor.destroy();

      const callsBefore1 = cb1.mock.calls.length;
      const callsBefore2 = cb2.mock.calls.length;
      await new Promise((r) => setTimeout(r, 60));

      expect(cb1.mock.calls.length).toBe(callsBefore1);
      expect(cb2.mock.calls.length).toBe(callsBefore2);
    });

    it("resets internal state on destroy", async () => {
      mockGetLatestLedger.mockResolvedValue({ sequence: 1 });
      const monitor = new ConnectionHealthMonitor("https://rpc.example.com", { intervalMs: 20 });
      monitor.recordRetry({
        attempt: 1,
        maxAttempts: 5,
        delayMs: 100,
        reason: "error",
        error: new Error("test"),
      });

      monitor.destroy();

      const metrics = monitor.getRetryMetrics();
      expect(metrics.totalRetries).toBe(0);
      expect(metrics.healthy).toBe(true);
    });

    it("allows restart after destroy", async () => {
      mockGetLatestLedger.mockResolvedValue({ sequence: 1 });
      const monitor = new ConnectionHealthMonitor("https://rpc.example.com", { intervalMs: 20 });
      const cb = jest.fn();
      monitor.onConnectionStatusChange(cb);

      await waitFor(() => cb.mock.calls.length > 0);
      monitor.destroy();

      jest.clearAllMocks();
      cb.mockClear();

      monitor.onConnectionStatusChange(cb);
      await waitFor(() => cb.mock.calls.length > 0);
      expect(cb).toHaveBeenCalledWith("connected");

      monitor.stop();
    });

    it("guards against double-start by clearing existing interval", async () => {
      mockGetLatestLedger.mockResolvedValue({ sequence: 1 });
      const monitor = new ConnectionHealthMonitor("https://rpc.example.com", { intervalMs: 50 });
      monitor.start();
      monitor.start();

      await new Promise((r) => setTimeout(r, 80));
      const callCount = mockGetLatestLedger.mock.calls.length;

      monitor.stop();
      // If double-start created duplicate intervals, we'd see more calls
      expect(callCount).toBeLessThan(5);
    });

    it("does not duplicate the polling loop or the listener when re-registered", async () => {
      mockGetLatestLedger.mockResolvedValue({ sequence: 1 });
      const monitor = new ConnectionHealthMonitor("https://rpc.example.com", { intervalMs: 50 });
      const cb = jest.fn();

      // Simulate a React effect re-running on every render with a stable callback ref.
      monitor.onConnectionStatusChange(cb);
      monitor.onConnectionStatusChange(cb);
      monitor.onConnectionStatusChange(cb);

      await waitFor(() => cb.mock.calls.length > 0);
      // A single status transition should fire the callback exactly once, not three times.
      expect(cb).toHaveBeenCalledTimes(1);
      monitor.stop();
    });

    it("onConnectionStatusChange returns an unsubscribe function that removes the listener", async () => {
      mockGetLatestLedger.mockResolvedValue({ sequence: 1 });
      const monitor = new ConnectionHealthMonitor("https://rpc.example.com", { intervalMs: 30 });
      const cb = jest.fn();
      const unsubscribe = monitor.onConnectionStatusChange(cb);

      await waitFor(() => cb.mock.calls.length > 0);
      unsubscribe();

      const callsBefore = cb.mock.calls.length;
      mockGetLatestLedger.mockRejectedValue(new Error("down"));
      await new Promise((r) => setTimeout(r, 60));

      expect(cb.mock.calls.length).toBe(callsBefore);
      monitor.stop();
    });
  });

  describe("LinkoraClient integration", () => {
    let LinkoraClient: typeof import("../client").LinkoraClient;
    const MockServer = rpc.Server as unknown as jest.Mock;
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

    it("exposes the configured network in detailed health results", async () => {
      mockGetNetwork.mockResolvedValue({ passphrase: "Test SDF Network ; September 2015" });
      const client = new LinkoraClient({
        contractId: "CDUMMY",
        rpcUrl: "https://rpc.example.com",
        networkPassphrase: "Public Global Stellar Network ; September 2015",
      });

      await expect(client.getHealthResult()).resolves.toMatchObject({
        healthy: false,
        expectedNetworkPassphrase: "Public Global Stellar Network ; September 2015",
        networkPassphrase: "Test SDF Network ; September 2015",
      });
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

    it("reuses a single rpc.Server across simulate, healthCheck, and prepareTransaction", async () => {
      MockServer.mockClear();
      mockGetLatestLedger.mockResolvedValue({ sequence: 1 });

      const client = new LinkoraClient({ contractId: "CDUMMY", rpcUrl: "https://rpc.example.com" });

      // The constructor should create exactly one rpc.Server
      expect(MockServer).toHaveBeenCalledTimes(1);
      const callsAfterCtor = MockServer.mock.calls.length;

      // healthCheck reuses the same server — no additional Server construction
      await client.healthCheck();
      expect(MockServer).toHaveBeenCalledTimes(1);

      // createRpcServer returns the cached instance
      const server = client.createRpcServer();
      expect(MockServer).toHaveBeenCalledTimes(1);
      expect(server).toBeDefined();

      // Confirm MockServer was not called again during any of the above
      expect(MockServer.mock.calls.length).toBe(callsAfterCtor);
    });
  });
  describe("jitter and backoff (Issue 1265)", () => {
    it("adds jitter to initial and subsequent checks", async () => {
      const setTimeoutSpy = jest.spyOn(global, "setTimeout");

      const monitor = new ConnectionHealthMonitor("https://rpc.example.com", {
        intervalMs: 50,
        backoffMs: 20,
      });
      monitor.start();

      expect(setTimeoutSpy).toHaveBeenCalled();
      const scheduledDelays = setTimeoutSpy.mock.calls
        .map((call) => call[1])
        .filter((delay): delay is number => typeof delay === "number" && delay <= 50);
      const firstCallDelay = Math.min(...scheduledDelays);
      expect(firstCallDelay).toBeGreaterThanOrEqual(0);
      expect(firstCallDelay).toBeLessThanOrEqual(50); // up to the initial interval jitter cap

      monitor.stop();
      setTimeoutSpy.mockRestore();
    });

    it("stops probing when max backoff is reached and can be resumed", async () => {
      mockGetLatestLedger.mockImplementation(() => {
        return Promise.reject(new Error("down"));
      });
      const monitor = new ConnectionHealthMonitor("https://rpc.example.com", {
        intervalMs: 10,
        backoffMs: 10,
        maxBackoffMs: 10,
      });
      monitor.start();

      // Wait for a few backoff cycles
      await new Promise((r) => setTimeout(r, 300));

      const checksAfterStop = mockGetLatestLedger.mock.calls.length;

      // Wait another 100ms to ensure no further checks occur
      await new Promise((r) => setTimeout(r, 100));
      expect(mockGetLatestLedger.mock.calls.length).toBe(checksAfterStop);

      // Manual resume should restart it
      monitor.resume();
      await new Promise((r) => setTimeout(r, 100));
      expect(mockGetLatestLedger.mock.calls.length).toBeGreaterThan(checksAfterStop);

      monitor.stop();
    });
  });
});
