/**
 * InflightCounter — tracks the number of in-flight WebSocket DB operations.
 *
 * Incremented before every DB write that originates from a WebSocket path and
 * decremented in the corresponding `finally` block, so the counter stays
 * accurate even when the write throws.
 *
 * The graceful-shutdown handler in server.ts waits for this counter to reach
 * zero (bounded by SHUTDOWN_DRAIN_TIMEOUT_MS) before closing the database
 * pool.
 */
export class InflightCounter {
  private count = 0;
  private resolvers: Array<() => void> = [];

  increment(): void {
    this.count++;
  }

  decrement(): void {
    if (this.count > 0) this.count--;
    if (this.count === 0) {
      const pending = this.resolvers.splice(0);
      for (const resolve of pending) resolve();
    }
  }

  get value(): number {
    return this.count;
  }

  /**
   * Returns a Promise that resolves immediately when the counter is already
   * zero, or as soon as it next reaches zero.
   */
  drain(): Promise<void> {
    if (this.count === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.resolvers.push(resolve);
    });
  }
}
