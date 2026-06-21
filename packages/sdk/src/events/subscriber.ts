import { createDefaultCursorStore, CursorStore } from "./cursor";
import { LinkoraEvent, parseContractEvent, SorobanEvent } from "./types";

export type LinkoraEventHandlers = {
  [T in LinkoraEvent["type"]]?: (event: Extract<LinkoraEvent, { type: T }>) => void | Promise<void>;
};

export interface LinkoraEventSubscriberConfig {
  rpcUrl: string;
  contractId: string;
  cursorStore?: CursorStore;
  cursorKeyOrPath?: string;
  startLedger?: number;
  pageLimit?: number;
  minPollIntervalMs?: number;
  maxPollIntervalMs?: number;
}

interface GetEventsResult {
  events: SorobanEvent[];
  latestLedger?: number;
}

const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_START_LEDGER = 0;
const DEFAULT_MIN_POLL_INTERVAL_MS = 100;
const DEFAULT_MAX_POLL_INTERVAL_MS = 5_000;

export class LinkoraEventSubscriber {
  private readonly cursorStore: CursorStore;
  private handlers: LinkoraEventHandlers = {};
  private running = false;
  private stopRequested = false;
  private timer: unknown;
  private loopPromise?: Promise<void>;
  private cursor?: string;
  private pollIntervalMs: number;

  constructor(private readonly config: LinkoraEventSubscriberConfig) {
    this.cursorStore = config.cursorStore ?? createDefaultCursorStore(config.cursorKeyOrPath);
    this.pollIntervalMs = config.minPollIntervalMs ?? DEFAULT_MIN_POLL_INTERVAL_MS;
  }

  subscribe(handlers: LinkoraEventHandlers): () => void {
    this.handlers = { ...this.handlers, ...handlers };
    return () => {
      for (const type of Object.keys(handlers) as LinkoraEvent["type"][]) {
        delete this.handlers[type];
      }
    };
  }

  async start(fromCursor?: string): Promise<void> {
    if (this.running) return;

    this.cursor = fromCursor ?? (await this.cursorStore.get());
    this.running = true;
    this.stopRequested = false;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    this.running = false;
    if (this.timer) {
      (globalThis as { clearTimeout?: (timer: unknown) => void }).clearTimeout?.(this.timer);
    }
    await this.loopPromise;
  }

  private async loop(): Promise<void> {
    while (!this.stopRequested) {
      try {
        const result = await this.fetchEvents();
        await this.processBatch(result.events);
        this.updatePollInterval(result.events.length);
      } catch (_err) {
        this.backoff();
      }

      if (!this.stopRequested) {
        await this.sleep(this.pollIntervalMs);
      }
    }
  }

  private async fetchEvents(): Promise<GetEventsResult> {
    const body: Record<string, unknown> = {
      jsonrpc: "2.0",
      id: 1,
      method: "getEvents",
      params: {
        startLedger: this.config.startLedger ?? DEFAULT_START_LEDGER,
        filters: [
          {
            type: "contract",
            contractIds: [this.config.contractId],
          },
        ],
        pagination: {
          limit: this.config.pageLimit ?? DEFAULT_PAGE_LIMIT,
          ...(this.cursor ? { cursor: this.cursor } : {}),
        },
      },
    };

    const fetchImpl = (globalThis as { fetch?: typeof fetch }).fetch;
    if (!fetchImpl) throw new Error("No fetch implementation available");

    const response = await fetchImpl(this.config.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`RPC request failed: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as {
      result?: GetEventsResult;
      error?: { message?: string };
    };

    if (json.error) {
      throw new Error(`RPC error: ${json.error.message ?? "unknown error"}`);
    }

    return {
      events: json.result?.events ?? [],
      latestLedger: json.result?.latestLedger,
    };
  }

  private async processBatch(events: SorobanEvent[]): Promise<void> {
    for (const raw of events) {
      if (this.stopRequested) break;

      const event = parseContractEvent(raw);
      if (event) {
        await this.emit(event);
      }

      if (raw.pagingToken) {
        this.cursor = raw.pagingToken;
        await this.cursorStore.set(raw.pagingToken);
      }
    }
  }

  private async emit(event: LinkoraEvent): Promise<void> {
    const handler = this.handlers[event.type] as
      | ((event: LinkoraEvent) => void | Promise<void>)
      | undefined;
    await handler?.(event);
  }

  private updatePollInterval(eventCount: number): void {
    const min = this.config.minPollIntervalMs ?? DEFAULT_MIN_POLL_INTERVAL_MS;
    if (eventCount >= (this.config.pageLimit ?? DEFAULT_PAGE_LIMIT)) {
      this.pollIntervalMs = min;
      return;
    }

    if (eventCount === 0) {
      this.backoff();
      return;
    }

    this.pollIntervalMs = min;
  }

  private backoff(): void {
    const max = this.config.maxPollIntervalMs ?? DEFAULT_MAX_POLL_INTERVAL_MS;
    this.pollIntervalMs = Math.min(
      Math.max(this.pollIntervalMs * 2, DEFAULT_MIN_POLL_INTERVAL_MS),
      max
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const setTimeoutImpl = (
        globalThis as { setTimeout?: (fn: () => void, ms: number) => unknown }
      ).setTimeout;
      if (!setTimeoutImpl) {
        resolve();
        return;
      }

      this.timer = setTimeoutImpl(() => {
        this.timer = undefined;
        resolve();
      }, ms);
    });
  }
}
