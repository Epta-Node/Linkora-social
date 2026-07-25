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
  webSocketUrl?: string;
  webSocketFactory?: WebSocketFactory;
}

interface GetEventsResult {
  events: SorobanEvent[];
  latestLedger?: number;
}

interface LinkoraWebSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export type WebSocketFactory = (url: string) => LinkoraWebSocket;

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
  private sleepResolve?: () => void;
  private loopPromise?: Promise<void>;
  private cursor?: string;
  private pollIntervalMs: number;
  private socket?: LinkoraWebSocket;

  constructor(private readonly config: LinkoraEventSubscriberConfig) {
    this.cursorStore = config.cursorStore ?? createDefaultCursorStore(config.cursorKeyOrPath);
    this.pollIntervalMs = config.minPollIntervalMs ?? DEFAULT_MIN_POLL_INTERVAL_MS;
  }

  /**
   * Subscribe to specific contract events.
   *
   * @param handlers An object mapping event types to their handler functions.
   * @returns A function that, when called, unsubscribes the provided handlers.
   *
   * @example
   * ```ts
   * const unsubscribe = subscriber.subscribe({
   *   post_created: async (event) => {
   *     console.log(`New post ${event.id} by ${event.author}`);
   *   },
   *   like: (event) => {
   *     console.log(`User ${event.user} liked post ${event.post_id}`);
   *   }
   * });
   *
   * // Later, to remove these specific handlers:
   * // unsubscribe();
   * ```
   */
  subscribe(handlers: LinkoraEventHandlers): () => void {
    this.handlers = { ...this.handlers, ...handlers };
    return () => {
      for (const type of Object.keys(handlers) as LinkoraEvent["type"][]) {
        delete this.handlers[type];
      }
    };
  }

  /**
   * Start fetching events from the RPC or WebSocket.
   *
   * @param fromCursor Optional cursor to start fetching from. If omitted, uses the stored cursor or startLedger.
   * @returns A promise that resolves once the background loop starts.
   *
   * @example
   * ```ts
   * try {
   *   await subscriber.start();
   *   console.log("Started listening for events...");
   * } catch (error) {
   *   console.error("Failed to start subscriber:", error.message);
   * }
   * ```
   */
  async start(fromCursor?: string): Promise<void> {
    if (this.running) return;

    this.cursor = fromCursor ?? (await this.cursorStore.get());
    this.running = true;
    this.stopRequested = false;
    this.loopPromise = this.config.webSocketUrl ? this.websocketLoop() : this.loop();
  }

  /**
   * Stop fetching events and clean up connections/timers.
   *
   * @returns A promise that resolves when the internal loops and connections have completely stopped.
   *
   * @example
   * ```ts
   * // Stop on application shutdown
   * await subscriber.stop();
   * console.log("Subscriber stopped.");
   * ```
   */
  async stop(): Promise<void> {
    this.stopRequested = true;
    this.running = false;
    this.socket?.close();
    this.socket = undefined;
    if (this.timer) {
      (globalThis as { clearTimeout?: (timer: unknown) => void }).clearTimeout?.(this.timer);
      this.timer = undefined;
    }
    this.sleepResolve?.();
    this.sleepResolve = undefined;
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

  private async websocketLoop(): Promise<void> {
    while (!this.stopRequested) {
      try {
        await this.connectWebSocket();
        this.pollIntervalMs = this.config.minPollIntervalMs ?? DEFAULT_MIN_POLL_INTERVAL_MS;
      } catch (_err) {
        this.backoff();
      }

      if (!this.stopRequested) {
        await this.sleep(this.pollIntervalMs);
      }
    }
  }

  private connectWebSocket(): Promise<void> {
    const url = this.config.webSocketUrl;
    if (!url) return Promise.resolve();

    const factory = this.config.webSocketFactory ?? getGlobalWebSocketFactory();
    if (!factory) throw new Error("No WebSocket implementation available");

    return new Promise((resolve, reject) => {
      let opened = false;
      const socket = factory(url);
      this.socket = socket;

      socket.onopen = () => {
        opened = true;
        socket.send(
          JSON.stringify({
            type: "subscribe",
            contractId: this.config.contractId,
            cursor: this.cursor,
            startLedger: this.config.startLedger ?? DEFAULT_START_LEDGER,
          })
        );
      };

      socket.onmessage = (message) => {
        void this.processWebSocketMessage(message.data).catch(() => {
          socket.close();
        });
      };

      socket.onerror = () => {
        if (!opened) reject(new Error("WebSocket connection failed"));
      };

      socket.onclose = () => {
        this.socket = undefined;
        if (this.stopRequested) {
          resolve();
          return;
        }

        if (opened) resolve();
        else reject(new Error("WebSocket closed before opening"));
      };
    });
  }

  private async processWebSocketMessage(data: unknown): Promise<void> {
    const message =
      typeof data === "string"
        ? (JSON.parse(data) as { event?: SorobanEvent; events?: SorobanEvent[] })
        : (data as { event?: SorobanEvent; events?: SorobanEvent[] });

    const events = message.events ?? (message.event ? [message.event] : []);
    await this.processBatch(events);
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
        this.sleepResolve = undefined;
        resolve();
      }, ms);
      this.sleepResolve = resolve;
    });
  }
}

function getGlobalWebSocketFactory(): WebSocketFactory | undefined {
  const WebSocketCtor = (globalThis as { WebSocket?: new (url: string) => LinkoraWebSocket })
    .WebSocket;
  return WebSocketCtor ? (url: string) => new WebSocketCtor(url) : undefined;
}
