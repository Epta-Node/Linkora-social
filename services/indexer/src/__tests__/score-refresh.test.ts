/**
 * Unit tests for ScoreRefreshService retry behaviour.
 *
 * The post_scores CONCURRENTLY refresh collides under load ("another refresh
 * is in progress") or with lock timeouts. These tests verify that collisions
 * are retried with backoff, that non-transient failures are not retried, and
 * that a Prometheus counter is emitted for every deferred attempt.
 */

import { ScoreRefreshService } from "../score-refresh";
import { scoreRefreshDeferredTotal } from "../metrics";

// ── Fake Pool / Client ───────────────────────────────────────────────────────

class FakeClient {
  readonly queries: string[] = [];
  refreshErrors: Error[] = [];
  released = false;

  async query(text: string): Promise<{ rows: Record<string, unknown>[] }> {
    this.queries.push(text);
    if (text.includes("REFRESH MATERIALIZED VIEW")) {
      const err = this.refreshErrors.shift();
      if (err) throw err;
    }
    return { rows: [] };
  }

  release(): void {
    this.released = true;
  }
}

function makeService(client: FakeClient, opts: { maxRetries?: number } = {}): ScoreRefreshService {
  const pool = { connect: async () => client } as never;
  return new ScoreRefreshService(pool, 5, {
    maxRetries: opts.maxRetries ?? 2,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 1,
    jitterFraction: 0,
  });
}

function concurrentRefreshError(): Error {
  const err = new Error(
    'cannot refresh materialized view "public.post_scores" concurrently\n' +
      "DETAIL:  Another concurrent refresh is in progress."
  );
  return err;
}

function lockTimeoutError(): Error {
  const err = new Error("canceling statement due to lock timeout") as Error & {
    code: string;
  };
  err.code = "55P03";
  return err;
}

function nonTransientError(): Error {
  return new Error('syntax error at or near "REFRESH"');
}

// ── Refresh success ──────────────────────────────────────────────────────────

describe("ScoreRefreshService.refreshScores", () => {
  beforeEach(() => {
    scoreRefreshDeferredTotal.reset();
  });

  it("issues the refresh inside a transaction with a statement_timeout", async () => {
    const client = new FakeClient();
    await makeService(client).refreshScores();

    expect(client.queries).toEqual([
      "BEGIN",
      "SET LOCAL statement_timeout = 30000",
      "REFRESH MATERIALIZED VIEW CONCURRENTLY post_scores",
      "COMMIT",
    ]);
    expect(scoreRefreshDeferredTotal.getValue()).toBe(0);
  });

  it("retries a concurrent-refresh collision and succeeds on the next attempt", async () => {
    const client = new FakeClient();
    client.refreshErrors = [concurrentRefreshError()];
    const service = makeService(client);

    await service.refreshScores();

    expect(client.queries).toEqual([
      "BEGIN",
      "SET LOCAL statement_timeout = 30000",
      "REFRESH MATERIALIZED VIEW CONCURRENTLY post_scores",
      "ROLLBACK",
      "BEGIN",
      "SET LOCAL statement_timeout = 30000",
      "REFRESH MATERIALIZED VIEW CONCURRENTLY post_scores",
      "COMMIT",
    ]);
    expect(scoreRefreshDeferredTotal.getValue()).toBe(1);
  });

  it("retries on a lock-timeout error (Postgres code 55P03)", async () => {
    const client = new FakeClient();
    client.refreshErrors = [lockTimeoutError()];
    const service = makeService(client);

    await service.refreshScores();

    expect(client.queries.filter((q) => q.includes("REFRESH MATERIALIZED VIEW"))).toHaveLength(2);
    expect(scoreRefreshDeferredTotal.getValue()).toBe(1);
  });

  it("does not retry non-transient failures and rethrows them", async () => {
    const client = new FakeClient();
    client.refreshErrors = [nonTransientError()];
    const service = makeService(client);

    await expect(service.refreshScores()).rejects.toThrow("syntax error");
    // No retry, no deferred metric.
    expect(client.queries.filter((q) => q.includes("REFRESH MATERIALIZED VIEW"))).toHaveLength(1);
    expect(scoreRefreshDeferredTotal.getValue()).toBe(0);
  });

  it("stops retrying and rethrows after exhausting maxRetries", async () => {
    const client = new FakeClient();
    // maxRetries=2 → 3 attempts: attempt 0, 1, 2 all fail on the collision.
    client.refreshErrors = [
      concurrentRefreshError(),
      concurrentRefreshError(),
      concurrentRefreshError(),
    ];
    const service = makeService(client, { maxRetries: 2 });

    await expect(service.refreshScores()).rejects.toThrow("refresh is in progress");

    expect(client.queries.filter((q) => q.includes("REFRESH MATERIALIZED VIEW"))).toHaveLength(3);
    expect(scoreRefreshDeferredTotal.getValue()).toBe(2);
  });
});
