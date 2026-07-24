import { TransactionQueue, TxStatusEvent, QueueSigner, RpcClient } from "../queue";
import { CircuitBreakerError } from "../errors";
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
}): RpcClient & { sendCalls: string[]; getCalls: string[] } {
  let stepsSent = 0;
  const sendCalls: string[] = [];
  const getCalls: string[] = [];
  return {
    sendCalls,
    getCalls,
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

describe("TransactionQueue", () => {
  it("runs a single step: pending → submitted → confirmed", async () => {
    const events: TxStatusEvent[] = [];
    const rpc = makeRpc();
    const queue = new TransactionQueue({ signer: makeSigner(), rpc, pollIntervalMs: 0 });
    queue.on("status", (e) => events.push(e));
    queue.enqueue("XDR_A");

    await queue.run();

    expect(events.map((e) => e.status)).toEqual(["pending", "submitted", "confirmed"]);
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
    expect(events.map((e) => e.status)).toEqual(["pending", "submitted", "confirmed"]);
    // Structured logging captured each retry with a delay and reason.
    expect(attempts).toHaveLength(2);
    expect(attempts.every((a) => a.reason === "error")).toBe(true);
  });

  it("respects a Retry-After hint on rate-limited responses", async () => {
    let sendAttempts = 0;
    const attempts: RetryAttemptInfo[] = [];
    const rpc: RpcClient = {
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
      // Cap ensures the 1s Retry-After is honored but bounded.
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
});
