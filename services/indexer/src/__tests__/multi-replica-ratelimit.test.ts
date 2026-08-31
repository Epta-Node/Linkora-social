/**
 * Multi-replica rate limiting.
 *
 * The bug this guards against: with a per-process in-memory store, N replicas
 * behind a load balancer give an attacker `limit × N` effective throughput,
 * because each replica only counts the requests it happened to receive. These
 * tests distribute requests round-robin across three independent limiter
 * instances and assert the limit applies to the deployment as a whole.
 *
 * Runs against a real Redis when `REDIS_URL` is set (the E2E compose file
 * provides one); otherwise it uses the in-process FakeRedis stand-in, which
 * implements the same sorted-set command surface. Either way all three
 * instances share one store — that sharing is the property under test.
 */

import {
  InMemoryRateLimitStore,
  RateLimiter,
  RedisRateLimitStore,
  type RateLimitStore,
} from "../middleware/rateLimit";
import { FakeRedis } from "./helpers/fake-redis";

const WINDOW_MS = 60_000;
const LIMIT = 100;
const REPLICAS = 3;
const CLIENT_IP = "203.0.113.7";

const REAL_REDIS_URL = process.env.REDIS_URL;

/**
 * Three RateLimiters over one shared store — the deployment we are asserting
 * about. Each limiter stands in for a replica behind the load balancer.
 */
function buildReplicas(store: RateLimitStore): RateLimiter[] {
  return Array.from({ length: REPLICAS }, () => new RateLimiter(store));
}

/** Send `count` requests round-robin and report how many were allowed. */
async function distributeRoundRobin(
  replicas: RateLimiter[],
  key: string,
  count: number,
  limit: number
): Promise<{ allowed: number; rejected: number }> {
  let allowed = 0;
  let rejected = 0;

  for (let i = 0; i < count; i++) {
    const replica = replicas[i % replicas.length];
    if (await replica.isAllowedAsync(key, limit)) {
      allowed++;
    } else {
      rejected++;
    }
  }

  return { allowed, rejected };
}

describe("multi-replica rate limiting", () => {
  describe("shared Redis store", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client: any;
    let store: RedisRateLimitStore;
    let usingRealRedis = false;

    beforeAll(async () => {
      if (REAL_REDIS_URL) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Redis = require("ioredis");
        const RedisClass = Redis.default ?? Redis;
        client = new RedisClass(REAL_REDIS_URL, {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 3,
          lazyConnect: true,
        });
        await client.connect();
        usingRealRedis = true;
      } else {
        client = new FakeRedis();
      }
      store = new RedisRateLimitStore(client, "rl:test:multi-replica:");
    });

    afterAll(async () => {
      await store.clear();
      if (usingRealRedis) await client.quit();
    });

    beforeEach(async () => {
      await store.clear();
    });

    it("enforces the limit across the deployment, not per replica", async () => {
      const replicas = buildReplicas(store);

      const { allowed, rejected } = await distributeRoundRobin(
        replicas,
        CLIENT_IP,
        LIMIT * REPLICAS,
        LIMIT
      );

      // The whole point: 300 requests spread over 3 replicas still only get
      // 100 through, not 100 per replica.
      expect(allowed).toBe(LIMIT);
      expect(rejected).toBe(LIMIT * REPLICAS - LIMIT);
    });

    it("rejects on every replica once the shared budget is spent", async () => {
      const replicas = buildReplicas(store);

      // Burn the entire budget on replica 0 alone.
      for (let i = 0; i < LIMIT; i++) {
        expect(await replicas[0].isAllowedAsync(CLIENT_IP, LIMIT)).toBe(true);
      }

      // Replicas 1 and 2 have served nothing, but they see the shared count.
      expect(await replicas[1].isAllowedAsync(CLIENT_IP, LIMIT)).toBe(false);
      expect(await replicas[2].isAllowedAsync(CLIENT_IP, LIMIT)).toBe(false);
    });

    it("keeps separate budgets for different clients", async () => {
      const replicas = buildReplicas(store);

      const attacker = await distributeRoundRobin(replicas, "198.51.100.4", LIMIT + 10, LIMIT);
      expect(attacker.allowed).toBe(LIMIT);

      // A different IP is unaffected by the attacker exhausting its own budget.
      expect(await replicas[0].isAllowedAsync("198.51.100.5", LIMIT)).toBe(true);
    });

    it("reports a retry delay derived from the shared window", async () => {
      const replicas = buildReplicas(store);

      await distributeRoundRobin(replicas, CLIENT_IP, LIMIT + 1, LIMIT);

      // The oldest in-window request was recorded on a *different* replica, so
      // a per-instance store could not answer this at all.
      const retryAfterMs = await replicas[2].getRemainingTimeAsync(CLIENT_IP);
      expect(retryAfterMs).toBeGreaterThan(0);
      expect(retryAfterMs).toBeLessThanOrEqual(WINDOW_MS);
    });
  });

  describe("per-replica in-memory stores (the vulnerable configuration)", () => {
    it("lets an attacker through at limit x replicaCount", async () => {
      // Each replica gets its own store — what happens today when REDIS_URL is
      // unset. This test documents the multiplier the production check exists
      // to prevent; it is not a configuration we want to ship.
      const stores = Array.from({ length: REPLICAS }, () => new InMemoryRateLimitStore(0));
      const replicas = stores.map((s) => new RateLimiter(s));

      const { allowed } = await distributeRoundRobin(replicas, CLIENT_IP, LIMIT * REPLICAS, LIMIT);

      expect(allowed).toBe(LIMIT * REPLICAS);

      stores.forEach((s) => s.destroy());
    });
  });
});
