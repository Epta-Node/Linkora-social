/**
 * Error-type-aware stream circuit breaker (#1179).
 *
 * The regression these guard is that a transient transport fault — an RPC
 * rolling restart, a pool checkout timeout — used to count toward the same
 * counter as a genuine defect and permanently halt the indexer.
 */

import {
  StreamCircuitBreaker,
  isRetriableStreamError,
  DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
} from "../stream-circuit";

function errWithCode(code: string, message = "boom"): Error {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

describe("isRetriableStreamError", () => {
  it.each(["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "EPIPE", "EHOSTUNREACH", "EAI_AGAIN"])(
    "classifies %s as retriable",
    (code) => {
      expect(isRetriableStreamError(errWithCode(code))).toBe(true);
    }
  );

  it("unwraps the cause chain that Node's fetch wraps transport errors in", () => {
    // `fetch` rejects with `TypeError: fetch failed`, the real code is nested.
    const wrapped = new TypeError("fetch failed");
    (wrapped as TypeError & { cause: unknown }).cause = errWithCode("ECONNREFUSED");
    expect(isRetriableStreamError(wrapped)).toBe(true);
  });

  it("classifies undici timeout codes as retriable", () => {
    expect(isRetriableStreamError(errWithCode("UND_ERR_CONNECT_TIMEOUT"))).toBe(true);
  });

  it("treats 429 and 5xx RPC responses as retriable", () => {
    expect(isRetriableStreamError({ status: 429, message: "Too Many Requests" })).toBe(true);
    expect(isRetriableStreamError({ status: 503, message: "Service Unavailable" })).toBe(true);
  });

  it("treats a 4xx other than 429 as persistent", () => {
    // A malformed request will not fix itself; retrying forever would hide it.
    expect(isRetriableStreamError({ status: 400, message: "Bad Request" })).toBe(false);
  });

  it("recognises a pg pool checkout timeout, which carries no error code", () => {
    expect(isRetriableStreamError(new Error("timeout exceeded when trying to connect"))).toBe(true);
  });

  it("treats ENOTFOUND as persistent, unlike EAI_AGAIN", () => {
    // A permanently unresolvable host is a misconfiguration and should be
    // allowed to trip the breaker; a temporary resolver failure should not.
    expect(isRetriableStreamError(errWithCode("ENOTFOUND"))).toBe(false);
    expect(isRetriableStreamError(errWithCode("EAI_AGAIN"))).toBe(true);
  });

  it("treats an unclassified error as persistent", () => {
    expect(isRetriableStreamError(new TypeError("cannot read property of undefined"))).toBe(false);
    expect(isRetriableStreamError(null)).toBe(false);
  });
});

describe("StreamCircuitBreaker", () => {
  it("defaults to a threshold of 10 and starts closed", () => {
    const breaker = new StreamCircuitBreaker();
    expect(breaker.threshold).toBe(DEFAULT_CIRCUIT_BREAKER_THRESHOLD);
    expect(breaker.state).toBe("closed");
  });

  it("takes a configurable threshold", () => {
    expect(new StreamCircuitBreaker({ threshold: 3 }).threshold).toBe(3);
  });

  it("never opens on retriable failures, no matter how many", () => {
    const breaker = new StreamCircuitBreaker({ threshold: 3, emit: () => {} });
    for (let i = 0; i < 50; i += 1) {
      breaker.recordRetriableFailure(errWithCode("ECONNREFUSED"));
    }
    expect(breaker.state).toBe("closed");
    expect(breaker.retriableFailures).toBe(50);
    expect(breaker.persistentFailures).toBe(0);
  });

  it("opens once persistent failures reach the threshold, and not before", () => {
    const breaker = new StreamCircuitBreaker({ threshold: 3, emit: () => {} });
    expect(breaker.recordPersistentFailure(new Error("x"))).toBe(false);
    expect(breaker.recordPersistentFailure(new Error("x"))).toBe(false);
    expect(breaker.state).toBe("closed");
    expect(breaker.recordPersistentFailure(new Error("x"))).toBe(true);
    expect(breaker.state).toBe("open");
  });

  it("resets the persistent counter on success, so failures must be consecutive", () => {
    const breaker = new StreamCircuitBreaker({ threshold: 3, emit: () => {} });
    breaker.recordPersistentFailure(new Error("x"));
    breaker.recordPersistentFailure(new Error("x"));
    breaker.recordSuccess();
    breaker.recordPersistentFailure(new Error("x"));
    breaker.recordPersistentFailure(new Error("x"));
    expect(breaker.state).toBe("closed");
  });

  it("closes again when a half-open probe succeeds", () => {
    const events: Record<string, unknown>[] = [];
    const breaker = new StreamCircuitBreaker({
      threshold: 1,
      emit: (e) => events.push(e),
    });

    breaker.recordPersistentFailure(new Error("x"));
    expect(breaker.state).toBe("open");
    breaker.beginProbe();
    expect(breaker.state).toBe("half_open");
    breaker.recordSuccess();
    expect(breaker.state).toBe("closed");

    expect(events.map((e) => e.metric)).toEqual([
      "stream_circuit_open",
      "stream_circuit_half_open",
      "stream_circuit_closed",
    ]);
  });

  it("reopens when the half-open probe fails", () => {
    const events: Record<string, unknown>[] = [];
    const breaker = new StreamCircuitBreaker({ threshold: 1, emit: (e) => events.push(e) });

    breaker.recordPersistentFailure(new Error("x"));
    breaker.beginProbe();
    expect(breaker.recordPersistentFailure(new Error("still broken"))).toBe(true);
    expect(breaker.state).toBe("open");

    expect(events.map((e) => e.metric)).toEqual([
      "stream_circuit_open",
      "stream_circuit_half_open",
      "stream_circuit_open",
    ]);
    expect(events[2].previousState).toBe("half_open");
  });

  it("does not re-emit while already open", () => {
    const events: Record<string, unknown>[] = [];
    const breaker = new StreamCircuitBreaker({ threshold: 1, emit: (e) => events.push(e) });
    breaker.recordPersistentFailure(new Error("x"));
    breaker.recordPersistentFailure(new Error("x"));
    expect(events.filter((e) => e.metric === "stream_circuit_open")).toHaveLength(1);
  });
});
