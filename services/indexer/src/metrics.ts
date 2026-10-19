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

export const streamCircuitTripsTotal = new Counter(
  "stream_circuit_trips_total",
  "Number of times the event stream circuit breaker opened"
);
export const notificationPushFailuresTotal = new Counter(
  "notification_push_failures_total",
  "Number of failed push delivery attempts"
);
export const notificationPushRetriesTotal = new Counter(
  "notification_push_retries_total",
  "Number of push delivery retries"
);
export const followCountDriftTotal = new Counter(
  "follow_count_drift_total",
  "Number of profiles whose indexed follow count differs from follows"
);

export const notificationsPrunedTotal = new Counter(
  "notifications_pruned_total",
  "Number of sent_notification rows deleted by the retention job"
);

export const deadLetterEventsTotal = new Counter(
  "dead_letter_events_total",
  "Number of events routed to the dead-letter queue"
);

export const processingLagMs = new Map<string, { total: number; count: number }>();

export function recordProcessingLag(eventType: string, lagMs: number): void {
  if (!processingLagMs.has(eventType)) {
    processingLagMs.set(eventType, { total: 0, count: 0 });
  }
  const stats = processingLagMs.get(eventType)!;
  stats.total += lagMs;
  stats.count += 1;
}

export const streamHealth = {
  started: false,
  open: false,
  circuitOpen: false,
  lastIngestedLedger: 0,
  lastBatchErrorAt: 0,
  batchErrors: 0,
  batches: 0,
  rawEventsBacklog: 0,
};

export function metricsText(): string {
  const lines = [
    serializationRetriesTotal,
    scoreRefreshDeferredTotal,
    streamCircuitTripsTotal,
    notificationPushFailuresTotal,
    notificationPushRetriesTotal,
    followCountDriftTotal,
    notificationsPrunedTotal,
    deadLetterEventsTotal,
  ]
    .map((metric) => metric.toPrometheus());

  for (const [eventType, stats] of processingLagMs.entries()) {
    const avgLag = stats.count > 0 ? stats.total / stats.count : 0;
    lines.push(`# HELP processing_lag_ms_${eventType} Average processing lag for ${eventType} events\n`);
    lines.push(`# TYPE processing_lag_ms_${eventType} gauge\n`);
    lines.push(`processing_lag_ms_${eventType} ${avgLag}\n`);
  }

  return lines
    .concat(
      `indexer_stream_open ${streamHealth.open ? 1 : 0}\n`,
      `indexer_last_ingested_ledger ${streamHealth.lastIngestedLedger}\n`,
      `indexer_raw_events_backlog ${streamHealth.rawEventsBacklog}\n`,
      `indexer_batch_error_rate ${streamHealth.batches ? streamHealth.batchErrors / streamHealth.batches : 0}\n`
    )
    .join("");
}
