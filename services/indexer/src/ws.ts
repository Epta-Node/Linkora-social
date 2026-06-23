/**
 * WebSocket fanout handler.
 *
 * Bridges the in-process event bus to connected WebSocket clients on the `/ws`
 * path. Every committed event is pushed as a `{ type, payload }` JSON frame.
 *
 * Clients may narrow what they receive by sending a subscribe control frame:
 *   { "action": "subscribe", "types": ["PostCreated", "Follow"] }
 * Sending `["*"]` or omitting the filter (the default) delivers every event.
 *
 * Liveness is maintained with a protocol-level ping/pong heartbeat every 15s;
 * clients that miss a heartbeat are terminated. See docs/indexer/WEBSOCKET_API.md.
 */

import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { EventBus, BusEvent, ALL_EVENTS } from "./bus";

export interface WsServerOptions {
  /** URL path to accept WebSocket upgrades on. Default "/ws". */
  path?: string;
  /** Heartbeat interval in milliseconds. Default 15000. */
  heartbeatMs?: number;
}

interface ClientState {
  isAlive: boolean;
  /** Event types this client wants; null means "all". */
  types: Set<string> | null;
}

export interface WsHandle {
  wss: WebSocketServer;
  /** Number of currently connected clients. */
  clientCount(): number;
  /** Stop heartbeats, unsubscribe from the bus, and close all sockets. */
  close(): Promise<void>;
}

const DEFAULT_HEARTBEAT_MS = 15_000;

/**
 * Attach a WebSocket server to an existing HTTP server and wire it to the bus.
 */
export function attachWebSocketServer(
  httpServer: HttpServer,
  bus: EventBus,
  opts: WsServerOptions = {}
): WsHandle {
  const path = opts.path ?? "/ws";
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;

  const wss = new WebSocketServer({ server: httpServer, path });
  const clients = new Map<WebSocket, ClientState>();

  wss.on("connection", (ws: WebSocket) => {
    const state: ClientState = { isAlive: true, types: null };
    clients.set(ws, state);

    ws.on("pong", () => {
      state.isAlive = true;
    });

    ws.on("message", (raw: RawData) => {
      handleControlFrame(ws, state, raw);
    });

    ws.on("close", () => {
      clients.delete(ws);
    });

    ws.on("error", (err) => {
      console.error("[ws] socket error:", err);
      clients.delete(ws);
    });
  });

  // ── Bus → clients fanout ──────────────────────────────────────────────────
  const unsubscribe = bus.on(ALL_EVENTS, (event: BusEvent) => {
    const frame = JSON.stringify({ type: event.type, payload: event });
    for (const [ws, state] of clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (state.types !== null && !state.types.has(event.type)) continue;
      ws.send(frame);
    }
  });

  // ── Heartbeat ─────────────────────────────────────────────────────────────
  const heartbeat = setInterval(() => {
    for (const [ws, state] of clients) {
      if (!state.isAlive) {
        clients.delete(ws);
        ws.terminate();
        continue;
      }
      state.isAlive = false;
      ws.ping();
    }
  }, heartbeatMs);
  // Don't keep the event loop alive solely for heartbeats.
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  return {
    wss,
    clientCount: () => clients.size,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        unsubscribe();
        for (const ws of clients.keys()) {
          ws.close(1001, "server shutting down");
        }
        clients.clear();
        wss.close(() => resolve());
      }),
  };
}

function handleControlFrame(ws: WebSocket, state: ClientState, raw: RawData): void {
  let msg: unknown;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    sendError(ws, "invalid JSON control frame");
    return;
  }

  if (typeof msg !== "object" || msg === null) {
    sendError(ws, "control frame must be an object");
    return;
  }

  const { action, types } = msg as { action?: string; types?: unknown };
  if (action !== "subscribe") {
    sendError(ws, `unknown action: ${String(action)}`);
    return;
  }

  if (!Array.isArray(types) || !types.every((t) => typeof t === "string")) {
    sendError(ws, "subscribe requires a string[] 'types' field");
    return;
  }

  if (types.length === 0 || types.includes(ALL_EVENTS)) {
    state.types = null; // all events
  } else {
    state.types = new Set(types as string[]);
  }

  ws.send(
    JSON.stringify({
      type: "subscribed",
      payload: { types: state.types === null ? [ALL_EVENTS] : [...state.types] },
    })
  );
}

function sendError(ws: WebSocket, message: string): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "error", payload: { message } }));
  }
}
