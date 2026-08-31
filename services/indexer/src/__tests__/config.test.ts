import { loadConfig } from "../config";

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

  it("reads pool sizing and shutdown timeout from the environment", () => {
    withEnv(
      {
        ...REQUIRED_ENV,
        DB_POOL_MAX: "50",
        DB_POOL_IDLE_TIMEOUT: "10000",
        DB_POOL_CONNECTION_TIMEOUT: "2000",
        SHUTDOWN_TIMEOUT_MS: "15000",
      },
      () => {
        const cfg = loadConfig();
        expect(cfg.dbPool).toEqual({
          max: 50,
          idleTimeoutMs: 10_000,
          connectionTimeoutMs: 2_000,
        });
        expect(cfg.shutdownTimeoutMs).toBe(15_000);
      }
    );
  });
});
