/**
 * WebSocket fanout handler.
 *
 * Bridges the in-process event bus to connected WebSocket clients on the `/ws`
 * path. Every committed event is pushed as a `{ type, payload }` JSON frame.
 *
 * ## Authentication
 *
 * When `WS_AUTH_REQUIRED=true` (or `opts.auth.required = true`) every new
 * connection must send an `auth` control frame before any events are delivered:
 *
 *   { "action": "auth", "address": "G...", "timestamp": <ms>, "signature": "<base64>" }
 *
 * The signature must be an Ed25519 signature (Stellar keypair) over the
 * SHA-256 hash of the canonical WS auth message:
 *
 *   `WS:AUTH:{address}:{timestamp}`
 *
 * Replay protection: `timestamp` must be within ±30 s of server time.
 * Connections that have not authenticated within `authDeadlineMs` (default
 * 30 s) are closed with code 1008.  A second `auth` frame is rejected.
 *
 * ## Outbound backpressure
 *
 * Each connection has a bounded outbound send queue (default 256 frames).
 * When the queue is full the oldest frame is dropped (head-drop) and a
 * `droppedFrames` counter is incremented.  When a connection has accumulated
 * more than `maxDropsBeforeDisconnect` (default 1024) total drops it is
 * terminated — it is too far behind to ever catch up.
 *
 * ## Subscription filter
 *
 * After authentication (or immediately when auth is disabled) clients may
 * narrow what they receive:
 *
 *   { "action": "subscribe", "types": ["PostCreated", "Follow"] }
 *
 * Sending `["*"]` or omitting the filter delivers every event.
 *
 * See docs/indexer/WEBSOCKET_API.md for the full client-facing reference.
 */

import { createHash } from "crypto";
import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { Keypair } from "@stellar/stellar-sdk";
import { EventBus, BusEvent, ALL_EVENTS } from "./bus";
import { TokenBucket, wsRateLimiterFromEnv, wsMaxMessageBytesFromEnv } from "./ratelimit";
import { logger } from "./logger";

// ── Close codes (RFC 6455) ────────────────────────────────────────────────────

const CLOSE_POLICY_VIOLATION = 1008;
const CLOSE_MESSAGE_TOO_LARGE = 1009;

// ── Auth constants ────────────────────────────────────────────────────────────

/** Maximum age (ms) accepted for a WS auth timestamp — replay window. */
export const WS_AUTH_TIMESTAMP_TOLERANCE_MS = 30_000;

/** Default deadline (ms) before an unauthenticated connection is closed. */
export const DEFAULT_AUTH_DEADLINE_MS = 30_000;

// ── Backpressure constants ────────────────────────────────────────────────────

/** Default maximum outbound frames queued per connection. */
export const DEFAULT_SEND_QUEUE_DEPTH = 256;

/** Default total drops before a connection is terminated as unrecoverable. */
export const DEFAULT_MAX_DROPS_BEFORE_DISCONNECT = 1024;

// ── Misc defaults ─────────────────────────────────────────────────────────────

const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_MAX_RATE_VIOLATIONS = 5;

// ── Public option types ───────────────────────────────────────────────────────

export interface WsAuthOptions {
  /**
   * Require a valid `auth` frame before delivering events.
   * Defaults to the `WS_AUTH_REQUIRED` env var, falling back to `false`.
   */
  required?: boolean;
  /**
   * Milliseconds before an unauthenticated connection is forcibly closed.
   * Default 30 000.
   */
  deadlineMs?: number;
}

export interface WsBackpressureOptions {
  /**
   * Maximum frames queued per connection. Oldest frame is dropped when full.
   * Default 256.
   */
  sendQueueDepth?: number;
  /**
   * Cumulative dropped frames before the connection is terminated.
   * Default 1024.
   */
  maxDropsBeforeDisconnect?: number;
}

export interface WsServerOptions {
  /** URL path to accept WebSocket upgrades on. Default "/ws". */
  path?: string;
  /** Heartbeat interval in milliseconds. Default 15 000. */
  heartbeatMs?: number;
  /** Maximum allowed inbound frame size in bytes. */
  maxPayloadBytes?: number;
  /**
   * Per-connection inbound message rate limit. Frames received while the
   * bucket is empty are dropped; connections flooding past `maxViolations`
   * consecutive over-budget frames are closed with 1008.
   */
  rateLimit?: {
    createBucket?: () => TokenBucket;
    maxViolations?: number;
  };
  /** Authentication configuration. */
  auth?: WsAuthOptions;
  /** Outbound backpressure configuration. */
  backpressure?: WsBackpressureOptions;
}

export interface WsHandle {
  wss: WebSocketServer;
  clientCount(): number;
  close(drainTimeoutMs?: number): Promise<void>;
}

// ── Internal per-connection state ─────────────────────────────────────────────

interface ClientState {
  isAlive: boolean;
  types: Set<string> | null;
  bucket: TokenBucket;
  rateViolations: number;

  // Auth
  address: string | null;
  authDeadlineTimer: ReturnType<typeof setTimeout> | null;

  // Backpressure
  sendQueue: string[];
  droppedFrames: number;
  draining: boolean;
}

// ── Auth helpers (exported for tests) ────────────────────────────────────────

/**
 * Canonical string the client must Ed25519-sign.  Intentionally distinct from
 * the HTTP `buildAuthMessage` so a captured WS credential cannot be replayed
 * against REST endpoints (and vice-versa).
 */
export function buildWsAuthMessage(address: string, timestamp: number): string {
  return `WS:AUTH:${address}:${timestamp}`;
}

/**
 * Verify a Stellar Ed25519 signature over the WS auth canonical message.
 * Returns false on any error (bad public key, bad base64, wrong sig…).
 */
export function verifyWsAuth(address: string, timestamp: number, signature: string): boolean {
  try {
    const message = buildWsAuthMessage(address, timestamp);
    const hash = createHash("sha256").update(message).digest();
    const keypair = Keypair.fromPublicKey(address);
    return keypair.verify(hash, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

// ── Outbound send queue ───────────────────────────────────────────────────────

/**
 * Enqueue a frame for delivery.  Drops the oldest frame when the queue is at
 * capacity and increments `droppedFrames`.  Returns `false` when the
 * connection should be terminated (too many cumulative drops).
 */
function enqueue(
  state: ClientState,
  frame: string,
  maxDepth: number,
  maxDrops: number
): boolean {
  if (state.sendQueue.length >= maxDepth) {
    state.sendQueue.shift(); // head-drop
    state.droppedFrames += 1;
    if (state.droppedFrames > maxDrops) {
      return false;
    }
  }
  state.sendQueue.push(frame);
  return true;
}

/**
 * Drain the send queue one frame at a time via the ws send callback, so we
 * never issue concurrent `ws.send()` calls that could reorder frames or
 * bypass our queue.
 */
function drainQueue(ws: WebSocket, state: ClientState): void {
  if (state.draining) return;
  state.draining = true;

  function sendNext(): void {
    if (ws.readyState !== WebSocket.OPEN) {
      state.draining = false;
      state.sendQueue.length = 0;
      return;
    }
    const frame = state.sendQueue.shift();
    if (frame === undefined) {
      state.draining = false;
      return;
    }
    ws.send(frame, (err) => {
      if (err) {
        state.draining = false;
        state.sendQueue.length = 0;
        return;
      }
      sendNext();
    });
  }

  sendNext();
}

// ── Main export ───────────────────────────────────────────────────────────────

export function attachWebSocketServer(
  httpServer: HttpServer,
  bus: EventBus,
  opts: WsServerOptions = {}
): WsHandle {
  const path = opts.path ?? "/ws";
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const maxPayloadBytes = opts.maxPayloadBytes ?? wsMaxMessageBytesFromEnv();

  const authRequired =
    opts.auth?.required ??
    (process.env.WS_AUTH_REQUIRED === "true" ||
      process.env.WS_AUTH_REQUIRED === "1");
  const authDeadlineMs = opts.auth?.deadlineMs ?? DEFAULT_AUTH_DEADLINE_MS;

  const sendQueueDepth = opts.backpressure?.sendQueueDepth ?? DEFAULT_SEND_QUEUE_DEPTH;
  const maxDropsBeforeDisconnect =
    opts.backpressure?.maxDropsBeforeDisconnect ?? DEFAULT_MAX_DROPS_BEFORE_DISCONNECT;

  const createBucket = opts.rateLimit?.createBucket ?? wsRateLimiterFromEnv;
  const maxRateViolations = opts.rateLimit?.maxViolations ?? DEFAULT_MAX_RATE_VIOLATIONS;

  const wss = new WebSocketServer({ server: httpServer, path, maxPayload: maxPayloadBytes });
  const clients = new Map<WebSocket, ClientState>();

  wss.on("connection", (ws: WebSocket) => {
    const state: ClientState = {
      isAlive: true,
      types: null,
      bucket: createBucket(),
      rateViolations: 0,
      address: null,
      authDeadlineTimer: null,
      sendQueue: [],
      droppedFrames: 0,
      draining: false,
    };
    clients.set(ws, state);

    if (authRequired) {
      state.authDeadlineTimer = setTimeout(() => {
        if (state.address === null && ws.readyState === WebSocket.OPEN) {
          logger.debug("[ws] auth deadline exceeded, closing unauthenticated client");
          sendError(ws, "authentication required");
          ws.close(CLOSE_POLICY_VIOLATION, "authentication required");
        }
      }, authDeadlineMs);
      if (typeof state.authDeadlineTimer.unref === "function") {
        state.authDeadlineTimer.unref();
      }
    }

    ws.on("pong", () => {
      state.isAlive = true;
    });

    ws.on("message", (raw: RawData) => {
      const rawLength = Buffer.isBuffer(raw)
        ? raw.length
        : Array.isArray(raw)
        ? raw.reduce((acc: number, b: Buffer) => acc + b.length, 0)
        : typeof raw === "string"
        ? Buffer.byteLength(raw)
        : (raw as ArrayBuffer).byteLength;

      if (rawLength > maxPayloadBytes) {
        ws.close(CLOSE_MESSAGE_TOO_LARGE, "message too large");
        return;
      }

      if (!state.bucket.tryRemove()) {
        state.rateViolations += 1;
        if (state.rateViolations > maxRateViolations) {
          ws.close(CLOSE_POLICY_VIOLATION, "rate limit exceeded");
          return;
        }
        sendError(ws, "rate limit exceeded, message dropped");
        return;
      }
      state.rateViolations = 0;
      handleControlFrame(ws, state, raw, authRequired);
    });

    ws.on("close", () => {
      cleanup(state);
      clients.delete(ws);
    });

    ws.on("error", (err) => {
      logger.debug({ err: (err as Error).message }, "[ws] socket error");
      cleanup(state);
      clients.delete(ws);
    });
  });

  // ── Bus → clients fanout ────────────────────────────────────────────────────
  const unsubscribe = bus.on(ALL_EVENTS, (event: BusEvent) => {
    const frame = JSON.stringify({ type: event.type, payload: event });
    for (const [ws, state] of clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (authRequired && state.address === null) continue;
      if (state.types !== null && !state.types.has(event.type)) continue;

      const ok = enqueue(state, frame, sendQueueDepth, maxDropsBeforeDisconnect);
      if (!ok) {
        logger.debug(
          { drops: state.droppedFrames, address: state.address },
          "[ws] disconnecting client: too many dropped frames"
        );
        ws.close(CLOSE_POLICY_VIOLATION, "too far behind");
        continue;
      }
      drainQueue(ws, state);
    }
  });

  // ── Heartbeat ───────────────────────────────────────────────────────────────
  const heartbeat = setInterval(() => {
    for (const [ws, state] of clients) {
      if (!state.isAlive) {
        cleanup(state);
        clients.delete(ws);
        ws.terminate();
        continue;
      }
      state.isAlive = false;
      ws.ping();
    }
  }, heartbeatMs);
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  return {
    wss,
    clientCount: () => clients.size,
    close: (drainTimeoutMs?: number) =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        unsubscribe();

        for (const [ws, state] of clients) {
          cleanup(state);
          ws.close(1001, "server shutting down");
        }

        const done = () => {
          clients.clear();
          wss.close(() => resolve());
        };

        if (drainTimeoutMs && clients.size > 0) {
          const timer = setTimeout(done, drainTimeoutMs);
          wss.on("close", () => {
            clearTimeout(timer);
            done();
          });
        } else {
          done();
        }
      }),
  };
}

// ── Control frame dispatch ────────────────────────────────────────────────────

function handleControlFrame(
  ws: WebSocket,
  state: ClientState,
  raw: RawData,
  authRequired: boolean
): void {
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

  const { action } = msg as { action?: unknown };

  if (action === "auth") {
    handleAuthFrame(ws, state, msg as Record<string, unknown>, authRequired);
    return;
  }

  if (action === "subscribe") {
    if (authRequired && state.address === null) {
      sendError(ws, "authentication required before subscribing");
      return;
    }
    handleSubscribeFrame(ws, state, msg as Record<string, unknown>);
    return;
  }

  sendError(ws, `unknown action: ${String(action)}`);
}

// ── Auth frame ────────────────────────────────────────────────────────────────

function handleAuthFrame(
  ws: WebSocket,
  state: ClientState,
  msg: Record<string, unknown>,
  authRequired: boolean
): void {
  // When auth is not required, still allow clients to optionally identify
  // themselves; store address if the payload is valid, otherwise acknowledge
  // anonymously without error (mixed-mode environments).
  if (!authRequired) {
    const { address, timestamp, signature } = msg;
    if (
      typeof address === "string" && address.trim() !== "" &&
      typeof timestamp === "number" &&
      typeof signature === "string" && signature.trim() !== ""
    ) {
      validateAndStoreAuth(ws, state, address, timestamp, signature);
    }
    // Always send authenticated ack so clients don't need to branch.
    sendAuthAck(ws, state.address ?? "(anonymous)");
    return;
  }

  if (state.address !== null) {
    sendError(ws, "already authenticated");
    return;
  }

  const { address, timestamp, signature } = msg;

  if (
    typeof address !== "string" || address.trim() === "" ||
    typeof timestamp !== "number" ||
    typeof signature !== "string" || signature.trim() === ""
  ) {
    sendError(ws, "auth frame requires string address, number timestamp, string signature");
    return;
  }

  if (validateAndStoreAuth(ws, state, address, timestamp, signature)) {
    sendAuthAck(ws, state.address!);
  }
}

/**
 * Validate timestamp + signature and, if valid, clear the deadline timer and
 * record the address.  On failure sends an error frame and closes the socket.
 * Returns true on success.
 */
function validateAndStoreAuth(
  ws: WebSocket,
  state: ClientState,
  address: string,
  timestamp: number,
  signature: string
): boolean {
  const age = Date.now() - timestamp;

  if (age < 0) {
    sendError(ws, "auth timestamp is in the future");
    ws.close(CLOSE_POLICY_VIOLATION, "invalid auth timestamp");
    return false;
  }

  if (age > WS_AUTH_TIMESTAMP_TOLERANCE_MS) {
    sendError(ws, "auth timestamp expired (replay protection)");
    ws.close(CLOSE_POLICY_VIOLATION, "auth timestamp expired");
    return false;
  }

  if (!verifyWsAuth(address, timestamp, signature)) {
    sendError(ws, "invalid signature");
    ws.close(CLOSE_POLICY_VIOLATION, "invalid signature");
    return false;
  }

  if (state.authDeadlineTimer !== null) {
    clearTimeout(state.authDeadlineTimer);
    state.authDeadlineTimer = null;
  }
  state.address = address;
  logger.debug({ address }, "[ws] client authenticated");
  return true;
}

function sendAuthAck(ws: WebSocket, address: string): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "authenticated", payload: { address } }));
  }
}

// ── Subscribe frame ───────────────────────────────────────────────────────────

function handleSubscribeFrame(
  ws: WebSocket,
  state: ClientState,
  msg: Record<string, unknown>
): void {
  const { types } = msg;
  if (!Array.isArray(types) || !types.every((t) => typeof t === "string")) {
    sendError(ws, "subscribe requires a string[] 'types' field");
    return;
  }

  if (types.length === 0 || types.includes(ALL_EVENTS)) {
    state.types = null;
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendError(ws: WebSocket, message: string): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "error", payload: { message } }));
  }
}

function cleanup(state: ClientState): void {
  if (state.authDeadlineTimer !== null) {
    clearTimeout(state.authDeadlineTimer);
    state.authDeadlineTimer = null;
  }
  state.sendQueue.length = 0;
}
