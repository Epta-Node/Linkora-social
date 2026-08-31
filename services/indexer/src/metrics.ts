/**
 * Small dependency-free metrics primitives used by the indexer.
 *
 * The service intentionally avoids a runtime metrics dependency in the core
 * pipeline. These counters expose Prometheus text while keeping unit tests
 * deterministic and lightweight.
 */

export class Counter {
  private value = 0;

  constructor(
    readonly name: string,
    readonly help: string
  ) {}

  inc(amount = 1): void {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error("Counter increments must be finite and non-negative");
    }
    this.value += amount;
  }

  getValue(): number {
    return this.value;
  }

  reset(): void {
    this.value = 0;
  }

  toPrometheus(): string {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
      `${this.name} ${this.value}`,
      "",
    ].join("\n");
  }
}

export const serializationRetriesTotal = new Counter(
  "serialization_retries_total",
  "Number of PostgreSQL serialization or deadlock retries"
);

export const scoreRefreshDeferredTotal = new Counter(
  "score_refresh_deferred_total",
  "Number of post_scores materialized-view refreshes deferred (active concurrent refresh or lock contention)"
);

export function metricsText(): string {
  return [serializationRetriesTotal.toPrometheus(), scoreRefreshDeferredTotal.toPrometheus()].join(
    ""
  );
}
