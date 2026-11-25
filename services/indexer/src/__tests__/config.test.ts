import { DB_POOL_MAX_MAX, DB_POOL_MAX_MIN, loadConfig, validateDbPoolConfig } from "../config";

const REQUIRED_ENV = {
  DATABASE_URL: "postgres://localhost/test",
  STELLAR_RPC_URL: "https://rpc.example",
  CONTRACT_ID: "CTEST",
  START_LEDGER: "1",
};

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    original[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(original)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

describe("loadConfig: connection pool + shutdown timeout", () => {
  it("defaults to max=20, idle=30s, connection=5s, shutdown=30s when unset", () => {
    withEnv(
      {
        ...REQUIRED_ENV,
        DB_POOL_MAX: undefined,
        DB_POOL_IDLE_TIMEOUT: undefined,
        DB_POOL_CONNECTION_TIMEOUT: undefined,
        SHUTDOWN_TIMEOUT_MS: undefined,
      },
      () => {
        const cfg = loadConfig();
        expect(cfg.dbPool).toEqual({
          max: 20,
          idleTimeoutMs: 30_000,
          connectionTimeoutMs: 5_000,
        });
        expect(cfg.shutdownTimeoutMs).toBe(30_000);
      }
    );
  });

  it("reads valid pool sizing and shutdown timeout from the environment", () => {
    withEnv(
      {
        ...REQUIRED_ENV,
        DB_POOL_MAX: "10",
        DB_POOL_IDLE_TIMEOUT: "10000",
        DB_POOL_CONNECTION_TIMEOUT: "2000",
        SHUTDOWN_TIMEOUT_MS: "15000",
      },
      () => {
        const cfg = loadConfig();
        expect(cfg.dbPool).toEqual({
          max: 10,
          idleTimeoutMs: 10_000,
          connectionTimeoutMs: 2_000,
        });
        expect(cfg.shutdownTimeoutMs).toBe(15_000);
      }
    );
  });

  it("rejects DB_POOL_MAX below minimum or above maximum", () => {
    for (const invalid of ["0", "1", "21", "50", "-5", "abc"]) {
      withEnv({ ...REQUIRED_ENV, DB_POOL_MAX: invalid }, () => {
        expect(() => loadConfig()).toThrow();
      });
    }
  });

  it("warns when pool max exceeds CPU core count and logs effective pool config", () => {
    const info = jest.fn();
    const warn = jest.fn();

    validateDbPoolConfig(
      { max: 8, idleTimeoutMs: 30_000, connectionTimeoutMs: 5_000 },
      { cpuCount: 4, log: { info, warn } }
    );

    expect(warn).toHaveBeenCalledWith(
      { dbPoolMax: 8, cpuCount: 4 },
      expect.stringContaining("exceeds available CPU core count")
    );
    expect(info).toHaveBeenCalledWith(
      { max: 8, idleTimeoutMs: 30_000, connectionTimeoutMs: 5_000, cpuCount: 4 },
      "Effective database connection pool configuration"
    );
  });

  it("does not warn when pool max is within CPU core count", () => {
    const info = jest.fn();
    const warn = jest.fn();

    validateDbPoolConfig(
      { max: DB_POOL_MAX_MIN, idleTimeoutMs: 30_000, connectionTimeoutMs: 5_000 },
      { cpuCount: DB_POOL_MAX_MAX, log: { info, warn } }
    );

    expect(warn).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
  });
});

describe("loadConfig: raw-events retention", () => {
  it("defaults to seven days and converts the period to ledgers", () => {
    withEnv({ ...REQUIRED_ENV, RAW_EVENTS_RETENTION_DAYS: undefined }, () =>
      expect(loadConfig().rawEventsRetention.retentionLedgers).toBe(7 * 17_280)
    );
  });

  it("uses RAW_EVENTS_RETENTION_DAYS when configured", () => {
    withEnv({ ...REQUIRED_ENV, RAW_EVENTS_RETENTION_DAYS: "3" }, () =>
      expect(loadConfig().rawEventsRetention.retentionLedgers).toBe(3 * 17_280)
    );
  });
});
