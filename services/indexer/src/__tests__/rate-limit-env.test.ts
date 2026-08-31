/**
 * Deployment-time validation of the shared rate-limit store.
 *
 * Covers the shared helper in @linkora/types plus the indexer's own startup
 * path, which is where the requirement actually bites.
 */

import {
  RateLimitConfigError,
  inMemoryRateLimitWarning,
  resolveRateLimitEnv,
} from "@linkora/types/src/rate-limit-env";
import { loadConfig } from "../config";

describe("resolveRateLimitEnv", () => {
  it("accepts a Redis URL and reports a shared store", () => {
    const resolved = resolveRateLimitEnv("indexer", {
      NODE_ENV: "production",
      REDIS_URL: "redis://redis:6379",
    });

    expect(resolved.redisUrl).toBe("redis://redis:6379");
    expect(resolved.expected).toEqual({ store: "redis", shared: true });
    expect(inMemoryRateLimitWarning(resolved)).toBeNull();
  });

  it("throws in production when REDIS_URL is unset", () => {
    expect(() => resolveRateLimitEnv("indexer", { NODE_ENV: "production" })).toThrow(
      RateLimitConfigError
    );
  });

  it("names the service and the multiplier in the failure message", () => {
    let message = "";
    try {
      resolveRateLimitEnv("indexer", { NODE_ENV: "production" });
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain("[indexer]");
    expect(message).toContain("REDIS_URL is required when NODE_ENV=production");
    expect(message).toContain("replicaCount");
  });

  it("treats a blank or whitespace-only REDIS_URL as unset", () => {
    expect(() =>
      resolveRateLimitEnv("indexer", { NODE_ENV: "production", REDIS_URL: "   " })
    ).toThrow(RateLimitConfigError);
  });

  it("allows the in-memory store outside production", () => {
    for (const NODE_ENV of ["development", "test", undefined]) {
      const resolved = resolveRateLimitEnv("indexer", { NODE_ENV });
      expect(resolved.redisUrl).toBeUndefined();
      expect(resolved.expected).toEqual({ store: "memory", shared: false });
    }
  });

  it("honours the explicit single-replica opt-out in production", () => {
    for (const flag of ["true", "1", "YES"]) {
      const resolved = resolveRateLimitEnv("indexer", {
        NODE_ENV: "production",
        ALLOW_IN_MEMORY_RATE_LIMIT: flag,
      });
      expect(resolved.inMemoryOptOut).toBe(true);
      expect(resolved.expected).toEqual({ store: "memory", shared: false });
    }
  });

  it("does not treat a falsey opt-out value as an opt-out", () => {
    for (const flag of ["false", "0", "no", ""]) {
      expect(() =>
        resolveRateLimitEnv("indexer", {
          NODE_ENV: "production",
          ALLOW_IN_MEMORY_RATE_LIMIT: flag,
        })
      ).toThrow(RateLimitConfigError);
    }
  });

  it("warns differently for an unset URL and an explicit opt-out", () => {
    const unset = inMemoryRateLimitWarning(resolveRateLimitEnv("indexer", {}));
    expect(unset).toContain("REDIS_URL is not set");

    const optOut = inMemoryRateLimitWarning(
      resolveRateLimitEnv("indexer", {
        NODE_ENV: "production",
        ALLOW_IN_MEMORY_RATE_LIMIT: "true",
      })
    );
    expect(optOut).toContain("ALLOW_IN_MEMORY_RATE_LIMIT is set");
  });
});

describe("indexer loadConfig", () => {
  const REQUIRED = {
    DATABASE_URL: "postgresql://linkora:linkora@localhost:5432/linkora",
    STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
    CONTRACT_ID: "CTEST",
    START_LEDGER: "1",
  };

  let saved: NodeJS.ProcessEnv;

  beforeEach(() => {
    saved = { ...process.env };
    Object.assign(process.env, REQUIRED);
    delete process.env.REDIS_URL;
    delete process.env.ALLOW_IN_MEMORY_RATE_LIMIT;
  });

  afterEach(() => {
    process.env = saved;
  });

  it("fails startup in production without REDIS_URL", () => {
    process.env.NODE_ENV = "production";
    expect(() => loadConfig()).toThrow(/REDIS_URL is required when NODE_ENV=production/);
  });

  it("starts in production with REDIS_URL and exposes it on the config", () => {
    process.env.NODE_ENV = "production";
    process.env.REDIS_URL = "redis://redis:6379";
    expect(loadConfig().redisUrl).toBe("redis://redis:6379");
  });

  it("starts without REDIS_URL outside production", () => {
    process.env.NODE_ENV = "development";
    expect(loadConfig().redisUrl).toBeUndefined();
  });
});
