import { Pool, PoolConfig } from "pg";
import { logger } from "./logger";

/**
 * A `pg.Pool` subclass that measures every query's wall-clock duration and
 * emits a structured warning through the shared logger when the duration
 * exceeds `slowQueryThresholdMs`.
 */
export class InstrumentedPool extends Pool {
  private readonly slowQueryThresholdMs: number;

  constructor(slowQueryThresholdMs: number, config?: PoolConfig) {
    super(config);
    this.slowQueryThresholdMs = slowQueryThresholdMs;
  }

  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unnecessary-type-constraint */
  override query<R = any, I = any[]>(...args: any[]): any {
    const start = Date.now();
    const queryTextOrConfig = args[0];
    const sqlSnippet =
      typeof queryTextOrConfig === "string"
        ? queryTextOrConfig.slice(0, 120)
        : "(prepared)";
    try {
      const res = (super.query as any)(...args);
      if (res && typeof res.then === "function") {
        return res
          .then((result: any) => {
            const dur = Date.now() - start;
            if (dur > this.slowQueryThresholdMs) {
              logger.warn({ dur, sql: sqlSnippet }, "slow-query");
            }
            return result;
          })
          .catch((err: any) => {
            const dur = Date.now() - start;
            logger.error({ dur, sql: sqlSnippet, err }, "query-error");
            throw err;
          });
      }
      return res;
    } catch (err) {
      const dur = Date.now() - start;
      logger.error({ dur, sql: sqlSnippet, err }, "query-error");
      throw err;
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unnecessary-type-constraint */
}
