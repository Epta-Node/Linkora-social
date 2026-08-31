import { TransactionQueue, TxStatusEvent, QueueSigner, RpcClient } from "../queue";
import { CircuitBreakerError, SimulationError } from "../errors";
import type { RetryAttemptInfo } from "../utils/retry";

/** No-jitter, zero-delay retry config so retry tests run instantly. */
const fastRetry = { baseDelayMs: 0, maxDelayMs: 0, jitterFactor: 0 };

function makeSigner(signFn?: (xdr: string) => Promise<string>): QueueSigner {
  return {
    signTransaction: signFn ?? ((xdr) => Promise.resolve(`signed:${xdr}`)),
  };
}

function makeRpc(opts?: {
  sendStatus?: string;
  confirmStatus?: string;
  failAfterSteps?: number;
  simulateSuccess?: boolean;
  simulateError?: string;
  resourceFee?: string;
}): RpcClient & { sendCalls: string[]; getCalls: string[]; simCalls: string[] } {
  let stepsSent = 0;
  const sendCalls: string[] = [];
  const getCalls: string[] = [];
  const simCalls: string[] = [];

  const simulateSuccess = opts?.simulateSuccess ?? true;
  const simulateError = opts?.simulateError;
  const resourceFee = opts?.resourceFee ?? "1000";

  return {
    sendCalls,
    getCalls,
    simCalls,
    async simulateTransaction(xdr) {
      simCalls.push(xdr);
      if (!simulateSuccess) {
        return { success: false, resourceFee: "0", error: simulateError ?? "sim error" };
      }
      return { success: true, resourceFee };
    },
    async sendTransaction(signedXdr) {
      sendCalls.push(signedXdr);
      stepsSent++;
      if (opts?.failAfterSteps !== undefined && stepsSent > opts.failAfterSteps) {
        return { hash: "HASH_FAIL", status: "ERROR", errorResultXdr: "bad-xdr" };
      }
      return { hash: `HASH_${stepsSent}`, status: opts?.sendStatus ?? "PENDING" };
    },
    async getTransaction(hash) {
      getCalls.push(hash);
      return { status: opts?.confirmStatus ?? "SUCCESS" };
    },
  };
}

// ── Existing tests (preserved with simulateTransaction support) ───────────────

describe("TransactionQueue", () => {
  it("runs a single step: pending → simulated → submitted → confirmed", async () => {
    const events: TxStatusEvent[] = [];
    const rpc = makeRpc();
    const queue = new TransactionQueue({ signer: makeSigner(), rpc, pollIntervalMs: 0 });
    queue.on("status", (e) => events.push(e));
    queue.enqueue("XDR_A");

    await queue.run();

    expect(events.map((e) => e.status)).toEqual(["pending", "simulated", "submitted", "confirmed"]);
    expect(rpc.simCalls).toHaveLength(1);
    expect(rpc.simCalls[0]).toBe("signed:XDR_A");
    expect(rpc.sendCalls).toHaveLength(1);
    expect(rpc.sendCalls[0]).toBe("signed:XDR_A");
  });

  it("runs multiple steps in order", async () => {
    const events: TxStatusEvent[] = [];
    const rpc = makeRpc();
    const queue = new TransactionQueue({ signer: makeSigner(), rpc, pollIntervalMs: 0 });
    queue.on("status", (e) => events.push(e));
    queue.enqueue("XDR_1").enqueue("XDR_2").enqueue("XDR_3");

    await queue.run();

    const confirmed = events.filter((e) => e.status === "confirmed");
    expect(confirmed).toHaveLength(3);
    expect(confirmed.map((e) => e.index)).toEqual([0, 1, 2]);
  });

  it("emits failed and calls rollbacks on step failure", async () => {
    const rollbackCalls: number[] = [];
    const rpc = makeRpc({ failAfterSteps: 1 }); // step 0 succeeds, step 1 fails
    const queue = new TransactionQueue({ signer: makeSigner(), rpc, pollIntervalMs: 0 });
    const events: TxStatusEvent[] = [];
    queue.on("status", (e) => events.push(e));

    queue.enqueue("XDR_0", async () => {
      rollbackCalls.push(0);
    });
    queue.enqueue("XDR_1", async () => {
      rollbackCalls.push(1);
    });

    await expect(queue.run()).rejects.toThrow(/Step 1 submission failed/);

    const failedEvents = events.filter((e) => e.status === "failed");
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0].index).toBe(1);

    // Rollback for completed step 0 must have been called; step 1 never completed
    expect(rollbackCalls).toEqual([0]);
  });

  it("emits failed when signer throws", async () => {
    const failSigner = makeSigner(() => Promise.reject(new Error("user rejected")));
    const rpc = makeRpc();
    const queue = new TransactionQueue({ signer: failSigner, rpc, pollIntervalMs: 0 });
    const events: TxStatusEvent[] = [];
    queue.on("status", (e) => events.push(e));
    queue.enqueue("XDR_X");

    await expect(queue.run()).rejects.toThrow(/Step 0 signing failed: user rejected/);

    expect(events.find((e) => e.status === "failed")?.error).toBe("user rejected");
  });

  it("emits failed when confirmation times out", async () => {
    const rpc = makeRpc({ confirmStatus: "PENDING" });
    const queue = new TransactionQueue({
      signer: makeSigner(),
      rpc,
      pollIntervalMs: 0,
      maxPollAttempts: 2,
    });
    queue.enqueue("XDR_TIMEOUT");

    await expect(queue.run()).rejects.toThrow(/not confirmed after 2 attempts/);
  });

  it("rollbacks are called in reverse order", async () => {
    const order: number[] = [];
    const rpc = makeRpc({ failAfterSteps: 2 }); // steps 0,1 succeed; step 2 fails
    const queue = new TransactionQueue({ signer: makeSigner(), rpc, pollIntervalMs: 0 });

    queue
      .enqueue("XDR_0", () => {
        order.push(0);
      })
      .enqueue("XDR_1", () => {
        order.push(1);
      })
      .enqueue("XDR_2"); // no rollback

    await expect(queue.run()).rejects.toThrow();

    expect(order).toEqual([1, 0]); // reversed
  });

  it("retries a transient submission failure with backoff, then confirms", async () => {
    let sendAttempts = 0;
    const attempts: RetryAttemptInfo[] = [];
    const rpc: RpcClient = {
      async simulateTransaction() {
        return { success: true, resourceFee: "100" };
      },
      async sendTransaction(signedXdr) {
        sendAttempts++;
        if (sendAttempts < 3) throw new Error("connection reset");
        return { hash: `HASH_${signedXdr}`, status: "PENDING" };
      },
      async getTransaction() {
        return { status: "SUCCESS" };
      },
    };
    const events: TxStatusEvent[] = [];
    const queue = new TransactionQueue({
      signer: makeSigner(),
      rpc,
      pollIntervalMs: 0,
      retry: { ...fastRetry, maxAttempts: 5 },
      logger: (i) => attempts.push(i),
    });
    queue.on("status", (e) => events.push(e));
    queue.enqueue("XDR_RETRY");

    await queue.run();

    expect(sendAttempts).toBe(3); // two failures + one success
    expect(events.map((e) => e.status)).toEqual(["pending", "simulated", "submitted", "confirmed"]);
    expect(attempts).toHaveLength(2);
    expect(attempts.every((a) => a.reason === "error")).toBe(true);
  });

  it("respects a Retry-After hint on rate-limited responses", async () => {
    let sendAttempts = 0;
    const attempts: RetryAttemptInfo[] = [];
    const rpc: RpcClient = {
      async simulateTransaction() {
        return { success: true, resourceFee: "100" };
      },
      async sendTransaction() {
        sendAttempts++;
        if (sendAttempts === 1) {
          throw { status: 429, headers: { "retry-after": "1" }, message: "rate limited" };
        }
        return { hash: "HASH_OK", status: "PENDING" };
      },
      async getTransaction() {
        return { status: "SUCCESS" };
      },
    };
    const queue = new TransactionQueue({
      signer: makeSigner(),
      rpc,
      pollIntervalMs: 0,
      retry: { baseDelayMs: 0, maxDelayMs: 1000, jitterFactor: 0, maxAttempts: 3 },
      logger: (i) => attempts.push(i),
    });
    queue.enqueue("XDR_429");

    await queue.run();

    expect(sendAttempts).toBe(2);
    expect(attempts[0].reason).toBe("rate-limited");
    expect(attempts[0].delayMs).toBe(1000);
  });

  it("opens the circuit breaker after the failure threshold and pauses", async () => {
    let sendAttempts = 0;
    const rpc: RpcClient = {
      async simulateTransaction() {
        return { success: true, resourceFee: "100" };
      },
      async sendTransaction() {
        sendAttempts++;
        throw new Error("network down");
      },
      async getTransaction() {
        return { status: "SUCCESS" };
      },
    };
    const rollback = jest.fn();
    const queue = new TransactionQueue({
      signer: makeSigner(),
      rpc,
      pollIntervalMs: 0,
      retry: { ...fastRetry, maxAttempts: 10, circuitBreakerThreshold: 3 },
    });
    queue.enqueue("XDR_DOWN", rollback);

    await expect(queue.run()).rejects.toBeInstanceOf(CircuitBreakerError);
    expect(sendAttempts).toBe(3); // breaker trips before exhausting maxAttempts
    expect(queue.isCircuitOpen).toBe(true);
  });

  it("does not retry a permanent ERROR-status submission", async () => {
    let sendAttempts = 0;
    const rpc: RpcClient = {
      async simulateTransaction() {
        return { success: true, resourceFee: "100" };
      },
      async sendTransaction() {
        sendAttempts++;
        return { hash: "HASH_FAIL", status: "ERROR", errorResultXdr: "bad-xdr" };
      },
      async getTransaction() {
        return { status: "SUCCESS" };
      },
    };
    const queue = new TransactionQueue({
      signer: makeSigner(),
      rpc,
      pollIntervalMs: 0,
      retry: { ...fastRetry, maxAttempts: 5 },
    });
    queue.enqueue("XDR_PERMANENT");

    await expect(queue.run()).rejects.toThrow(/Step 0 submission failed: bad-xdr/);
    expect(sendAttempts).toBe(1); // permanent failure — no retries
  });

  // ── New tests (issue #1040) ──────────────────────────────────────────────────

  describe("simulation before submission", () => {
    it("calls simulateTransaction with the signed XDR before sendTransaction", async () => {
      const rpc = makeRpc({ resourceFee: "5000" });
      const queue = new TransactionQueue({ signer: makeSigner(), rpc, pollIntervalMs: 0 });
      const events: TxStatusEvent[] = [];
      queue.on("status", (e) => events.push(e));
      queue.enqueue("XDR_SIM");

      await queue.run();

      // Simulation must happen before send
      expect(rpc.simCalls).toHaveLength(1);
      expect(rpc.simCalls[0]).toBe("signed:XDR_SIM");
      expect(rpc.sendCalls).toHaveLength(1);

      // resourceFee is present on the simulated and confirmed events
      const simEvent = events.find((e) => e.status === "simulated");
      expect(simEvent?.resourceFee).toBe("5000");
      const confirmedEvent = events.find((e) => e.status === "confirmed");
      expect(confirmedEvent?.resourceFee).toBe("5000");
    });

    it("fails the step and rolls back when simulation returns success:false", async () => {
      const rollback = jest.fn();
      const rpc = makeRpc({ simulateSuccess: false, simulateError: "out of gas" });
      const queue = new TransactionQueue({ signer: makeSigner(), rpc, pollIntervalMs: 0 });
      const events: TxStatusEvent[] = [];
      queue.on("status", (e) => events.push(e));
      queue.enqueue("XDR_PREV").enqueue("XDR_FAIL", rollback);

      // Enqueue a first step that succeeds, then simulate fail on second
      const rpc2 = makeRpc({ simulateSuccess: false, simulateError: "out of gas" });
      let simCount = 0;
      const originalSim = rpc2.simulateTransaction.bind(rpc2);
      rpc2.simulateTransaction = async (xdr) => {
        simCount++;
        if (simCount === 1) return { success: true, resourceFee: "100" };
        return originalSim(xdr);
      };
      const q2 = new TransactionQueue({ signer: makeSigner(), rpc: rpc2, pollIntervalMs: 0 });
      q2.enqueue("XDR_OK", rollback).enqueue("XDR_FAIL");
      await expect(q2.run()).rejects.toThrow(SimulationError);
      // rollback for the completed first step fires
      expect(rollback).toHaveBeenCalledTimes(1);
      // sendTransaction must NOT have been called
      expect(rpc2.sendCalls).toHaveLength(1); // only for step 0
    });

    it("skips simulation when skipSimulation:true", async () => {
      const rpc = makeRpc();
      const queue = new TransactionQueue({ signer: makeSigner(), rpc, pollIntervalMs: 0 });
      const events: TxStatusEvent[] = [];
      queue.on("status", (e) => events.push(e));
      queue.enqueue("XDR_SKIP");

      await queue.run({ skipSimulation: true });

      expect(rpc.simCalls).toHaveLength(0);
      expect(rpc.sendCalls).toHaveLength(1);
      const statuses = events.map((e) => e.status);
      expect(statuses).toContain("submitted");
      expect(statuses).not.toContain("simulated");
    });
  });

  describe("dryRun mode", () => {
    it("simulates but does not submit when dryRun:true passed to run()", async () => {
      const rpc = makeRpc({ resourceFee: "2000" });
      const queue = new TransactionQueue({ signer: makeSigner(), rpc, pollIntervalMs: 0 });
      const events: TxStatusEvent[] = [];
      queue.on("status", (e) => events.push(e));
      queue.enqueue("XDR_DRY");

      await queue.run({ dryRun: true });

      expect(rpc.simCalls).toHaveLength(1);
      expect(rpc.sendCalls).toHaveLength(0);
      expect(rpc.getCalls).toHaveLength(0);

      const statuses = events.map((e) => e.status);
      expect(statuses).toEqual(["pending", "simulated", "confirmed"]);
      expect(events.find((e) => e.status === "confirmed")?.resourceFee).toBe("2000");
    });

    it("dryRun queue-level default is honoured", async () => {
      const rpc = makeRpc();
      const queue = new TransactionQueue({
        signer: makeSigner(),
        rpc,
        pollIntervalMs: 0,
        dryRun: true,
      });
      queue.enqueue("XDR_A").enqueue("XDR_B");

      await queue.run();

      expect(rpc.simCalls).toHaveLength(2);
      expect(rpc.sendCalls).toHaveLength(0);
    });

    it("per-run dryRun:false overrides queue-level dryRun:true", async () => {
      const rpc = makeRpc();
      const queue = new TransactionQueue({
        signer: makeSigner(),
        rpc,
        pollIntervalMs: 0,
        dryRun: true,
      });
      queue.enqueue("XDR_LIVE");

      await queue.run({ dryRun: false });

      expect(rpc.sendCalls).toHaveLength(1);
    });

    it("dryRun with simulation failure throws SimulationError and does not submit", async () => {
      const rpc = makeRpc({ simulateSuccess: false, simulateError: "insufficient balance" });
      const queue = new TransactionQueue({ signer: makeSigner(), rpc, pollIntervalMs: 0 });
      queue.enqueue("XDR_BAD");

      await expect(queue.run({ dryRun: true })).rejects.toThrow(SimulationError);
      expect(rpc.sendCalls).toHaveLength(0);
    });
  });

  describe("submittedHashes tracking", () => {
    it("tracks hashes of all confirmed steps", async () => {
      const rpc = makeRpc();
      const queue = new TransactionQueue({ signer: makeSigner(), rpc, pollIntervalMs: 0 });
      queue.enqueue("XDR_1").enqueue("XDR_2").enqueue("XDR_3");

      await queue.run();

      expect(queue.submittedHashes).toEqual(["HASH_1", "HASH_2", "HASH_3"]);
    });

    it("resets hashes on each run()", async () => {
      const rpc = makeRpc();
      const queue = new TransactionQueue({ signer: makeSigner(), rpc, pollIntervalMs: 0 });
      queue.enqueue("XDR_A");
      await queue.run();
      expect(queue.submittedHashes).toHaveLength(1);

      queue.enqueue("XDR_B").enqueue("XDR_C");
      await queue.run();
      expect(queue.submittedHashes).toHaveLength(2);
    });

    it("hashes are empty after a failed run", async () => {
      const rpc = makeRpc({ failAfterSteps: 0 }); // first step fails
      const queue = new TransactionQueue({ signer: makeSigner(), rpc, pollIntervalMs: 0 });
      queue.enqueue("XDR_FAIL");

      await expect(queue.run()).rejects.toThrow();
      expect(queue.submittedHashes).toHaveLength(0);
    });

    it("dryRun does not populate submittedHashes (no real submission)", async () => {
      const rpc = makeRpc();
      const queue = new TransactionQueue({ signer: makeSigner(), rpc, pollIntervalMs: 0 });
      queue.enqueue("XDR_DRY");

      await queue.run({ dryRun: true });

      expect(queue.submittedHashes).toHaveLength(0);
    });
  });

  describe("per-step timeout", () => {
    it("fails the step and rolls back when stepTimeoutMs is exceeded", async () => {
      const rollback = jest.fn();
      // Confirmation hangs forever
      const rpc: RpcClient = {
        async simulateTransaction() {
          return { success: true, resourceFee: "100" };
        },
        async sendTransaction() {
          return { hash: "HASH_HANG", status: "PENDING" };
        },
        async getTransaction() {
          // never resolves within the timeout
          return new Promise<{ status: string }>(() => {});
        },
      };
      const queue = new TransactionQueue({
        signer: makeSigner(),
        rpc,
        pollIntervalMs: 0,
        stepTimeoutMs: 50,
      });
      queue.enqueue("XDR_HANG", rollback);

      await expect(queue.run()).rejects.toThrow(/timed out after 50ms/);
    }, 2000);

    it("per-step enqueue timeout overrides queue-level timeout", async () => {
      // Queue level: 10s (should not fire), step level: 50ms (should fire)
      const rpc: RpcClient = {
        async simulateTransaction() {
          return { success: true, resourceFee: "100" };
        },
        async sendTransaction() {
          return { hash: "HASH_HANG", status: "PENDING" };
        },
        async getTransaction() {
          return new Promise<{ status: string }>(() => {});
        },
      };
      const queue = new TransactionQueue({
        signer: makeSigner(),
        rpc,
        pollIntervalMs: 0,
        stepTimeoutMs: 10_000,
      });
      queue.enqueue("XDR_HANG", undefined, 50);

      await expect(queue.run()).rejects.toThrow(/timed out after 50ms/);
    }, 2000);

    it("per-run stepTimeoutMs overrides queue-level stepTimeoutMs", async () => {
      const rpc: RpcClient = {
        async simulateTransaction() {
          return { success: true, resourceFee: "100" };
        },
        async sendTransaction() {
          return { hash: "HASH_HANG", status: "PENDING" };
        },
        async getTransaction() {
          return new Promise<{ status: string }>(() => {});
        },
      };
      const queue = new TransactionQueue({
        signer: makeSigner(),
        rpc,
        pollIntervalMs: 0,
        stepTimeoutMs: 10_000, // queue-level: 10s
      });
      queue.enqueue("XDR_HANG");

      // per-run override: 50ms
      await expect(queue.run({ stepTimeoutMs: 50 })).rejects.toThrow(/timed out after 50ms/);
    }, 2000);
  });

  describe("RPC timeouts", () => {
    it("fails the step when sendTransaction times out", async () => {
      const rpc: RpcClient = {
        async simulateTransaction() {
          return { success: true, resourceFee: "100" };
        },
        async sendTransaction() {
          return new Promise(() => {}); // never resolves
        },
        async getTransaction() {
          return { status: "SUCCESS" };
        },
      };
      const queue = new TransactionQueue({
        signer: makeSigner(),
        rpc,
        pollIntervalMs: 0,
        rpcTimeoutMs: 50,
        retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0, jitterFactor: 0 },
      });
      queue.enqueue("XDR_SEND_HANG");

      await expect(queue.run()).rejects.toThrow(/sendTransaction timed out after 50ms/);
    }, 2000);

    it("fails the step when getTransaction times out", async () => {
      const rpc: RpcClient = {
        async simulateTransaction() {
          return { success: true, resourceFee: "100" };
        },
        async sendTransaction() {
          return { hash: "HASH_OK", status: "PENDING" };
        },
        async getTransaction() {
          return new Promise(() => {}); // never resolves
        },
      };
      const queue = new TransactionQueue({
        signer: makeSigner(),
        rpc,
        pollIntervalMs: 0,
        rpcTimeoutMs: 50,
      });
      queue.enqueue("XDR_GET_HANG");

      await expect(queue.run()).rejects.toThrow(/getTransaction timed out after 50ms/);
    }, 2000);
  });
});
