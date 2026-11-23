import { Router, Request, Response } from "express";
import { WebSocket } from "ws";
import { Database, DbMessage } from "./database";
import { AuthService } from "./auth";
import {
  messageAuthMiddleware,
  addressOwnershipMiddleware,
  conversationParticipantMiddleware,
} from "./middleware/auth";
import { rateLimitMiddleware } from "./middleware/rateLimit";
import { validateBody, validateQuery, validateParams } from "./middleware/validate";
import {
  getSendMessageSchema,
  GetMessagesQuerySchema,
  AddressParamSchema,
  ConversationIdParamSchema,
  parseCursor,
  createCursor,
  getMaxMessageBytes,
  type SendMessageRequest,
} from "./validation";
import { stellarAddressSchema } from "@linkora/types/src/schemas";
import { createConversationId, sanitizeError } from "./utils";
import { z, ZodError } from "zod";
import { idempotencyMiddleware } from "./middleware/idempotency";
import { logger } from "./logger";
import {
  validationError,
  unauthorizedError,
  conflictError,
  internalError,
} from "@linkora/types/src/errors";
import type { InflightCounter } from "./inflight-counter";
import { TypingRateLimitMap } from "./typing-rate-limit";

const CLOSE_MESSAGE_TOO_LARGE = 1009;

/** Typing-notification throttle window; entries older than this are pruned (#1330). */
const TYPING_RATE_LIMIT_WINDOW_MS = 3000;
/** Hard cap on distinct (sender, recipient) pairs tracked at once (#1330). */
const TYPING_RATE_LIMIT_MAX_PAIRS = 50_000;

const wsClients = new Map<string, Set<WebSocket>>();
const typingRateLimitMap = new TypingRateLimitMap(
  TYPING_RATE_LIMIT_WINDOW_MS,
  TYPING_RATE_LIMIT_MAX_PAIRS
);

/** Test-only accessor for the typing rate-limit map's current size (#1330). */
export function getTypingRateLimitMapSizeForTests(): number {
  return typingRateLimitMap.size;
}

// ── Delivery / read-receipt state (#1754) ─────────────────────────────────────
//
// In-memory map from messageId → sender address so we can route ACKs back to
// the original sender's WebSocket connection(s).
// This is intentionally lightweight (process-scoped): for multi-replica
// deployments a shared Redis pubsub channel would be needed, but the
// data structure and protocol are identical.

const pendingAckSenders = new Map<string, string>(); // messageId → senderAddress

/**
 * Register a message as pending delivery confirmation.
 * Called immediately after the message is stored so the sender's ACK
 * subscription is active before the push to the recipient fires.
 */
function trackPendingMessage(messageId: string, senderAddress: string): void {
  pendingAckSenders.set(messageId, senderAddress);
  // Auto-evict after 24 h to prevent unbounded growth (issue #1754 requirement).
  setTimeout(() => pendingAckSenders.delete(messageId), 24 * 60 * 60 * 1000).unref();
}

/**
 * Route a delivery or read receipt back to the original sender.
 * Silently drops the event if the sender is no longer connected.
 */
function forwardReceiptToSender(
  messageId: string,
  type: "delivered" | "read",
  extra: Record<string, unknown> = {}
): void {
  const senderAddress = pendingAckSenders.get(messageId);
  if (!senderAddress) return;
  pushToRecipient(senderAddress, { type, messageId, ...extra }).catch((err) => {
    logger.warn({ err, messageId, type }, "Failed to forward receipt to sender");
  });
}

const CLOSE_MESSAGE_TOO_LARGE = 1009;

/** Typing-notification throttle window; entries older than this are pruned (#1330). */
const TYPING_RATE_LIMIT_WINDOW_MS = 3000;
/** Hard cap on distinct (sender, recipient) pairs tracked at once (#1330). */
const TYPING_RATE_LIMIT_MAX_PAIRS = 50_000;

const wsClients = new Map<string, Set<WebSocket>>();
const typingRateLimitMap = new TypingRateLimitMap(
  TYPING_RATE_LIMIT_WINDOW_MS,
  TYPING_RATE_LIMIT_MAX_PAIRS
);

/** Test-only accessor for the typing rate-limit map's current size (#1330). */
export function getTypingRateLimitMapSizeForTests(): number {
  return typingRateLimitMap.size;
}

/**
 * Register a WebSocket client for a given Stellar address.
 *
 * `inflightCounter` is optional to preserve backwards-compatibility with
 * tests that call this function without a counter.  When provided, every DB
 * write that is triggered by an incoming WS message increments the counter
 * before the write and decrements it in the `finally` block, so the
 * graceful-shutdown handler can wait for all writes to complete.
 */
export function registerWsClient(
  address: string,
  ws: WebSocket,
  inflightCounter?: InflightCounter,
  maxMessageBytes: number = getMaxMessageBytes()
): void {
  if (!wsClients.has(address)) wsClients.set(address, new Set());
  wsClients.get(address)!.add(ws);

  ws.on("message", async (data) => {
    const rawLength = Buffer.isBuffer(data)
      ? data.length
      : Array.isArray(data)
        ? data.reduce((acc, b) => acc + b.length, 0)
        : typeof data === "string"
          ? Buffer.byteLength(data)
          : (data as ArrayBuffer).byteLength;

    if (rawLength > maxMessageBytes) {
      logger.warn(
        { authenticatedAddress: address, rawLength, maxMessageBytes },
        "WebSocket frame exceeded max message size limit"
      );
      ws.close(CLOSE_MESSAGE_TOO_LARGE, "Message too large");
      return;
    }

    try {
      const payload = JSON.parse(data.toString());

      // ── Delivery confirmation protocol (#1754) ──────────────────────────────
      //
      // `delivered` — sent by the recipient client when the message is received.
      // `read`      — sent by the recipient client when the conversation is opened.
      // Both are forwarded to the original sender's WebSocket connection(s).

      if (payload.type === "delivered") {
        const messageId = payload.messageId;
        if (typeof messageId !== "string" || messageId.length === 0) {
          logger.warn({ authenticatedAddress: address }, "Invalid delivered receipt: missing messageId");
          return;
        }
        logger.info({ messageId, recipient: address }, "Delivered receipt received");
        forwardReceiptToSender(messageId, "delivered");
        return;
      }

      if (payload.type === "read") {
        const messageId = payload.messageId;
        if (typeof messageId !== "string" || messageId.length === 0) {
          logger.warn({ authenticatedAddress: address }, "Invalid read receipt: missing messageId");
          return;
        }
        const readAt = typeof payload.readAt === "number" ? payload.readAt : Date.now();
        logger.info({ messageId, recipient: address, readAt }, "Read receipt received");
        forwardReceiptToSender(messageId, "read", { readAt });
        return;
      }

      // ── Typing notification (#1330) ─────────────────────────────────────────
      if (payload.type === "typing_status") {
        if (payload.sender && payload.sender !== address) {
          logger.warn(
            { authenticatedAddress: address, payloadSender: payload.sender },
            "Typing notification sender mismatch abuse detected"
          );
          return;
        }

        const recipient = payload.recipient;
        if (typeof recipient !== "string" || !stellarAddressSchema.safeParse(recipient).success) {
          logger.warn(
            { authenticatedAddress: address, recipient },
            "Invalid typing notification recipient address"
          );
          return;
        }

        const rateLimitKey = `${address}:${recipient}`;
        const now = Date.now();
        const lastSent = typingRateLimitMap.get(rateLimitKey, now);
        if (lastSent !== undefined && now - lastSent < TYPING_RATE_LIMIT_WINDOW_MS) {
          logger.warn(
            { authenticatedAddress: address, recipient },
            "Typing notification rate limit exceeded"
          );
          return;
        }
        typingRateLimitMap.touch(rateLimitKey, now);

        inflightCounter?.increment();
        try {
          logger.info({ sender: address, recipient }, "Typing status notification dispatched");
          await pushToRecipient(recipient, {
            type: "typing_status",
            sender: address,
          });
        } catch (err) {
          logger.error({ err, sender: address, recipient }, "Failed to push typing status");
        } finally {
          inflightCounter?.decrement();
        }
      }
    } catch (e) {
      // Ignore invalid JSON from clients
    }
  });

  ws.on("close", () => {
    wsClients.get(address)?.delete(ws);
    if (wsClients.get(address)?.size === 0) wsClients.delete(address);
  });
}

function pushToRecipient(recipient: string, payload: object): Promise<void> {
  const sockets = wsClients.get(recipient);
  if (!sockets) return Promise.resolve();
  const openSockets = [...sockets].filter((ws) => ws.readyState === WebSocket.OPEN);
  if (openSockets.length === 0) return Promise.resolve();

  const data = JSON.stringify(payload);
  const promises = openSockets.map(
    (ws) =>
      new Promise<void>((resolve) => {
        try {
          ws.send(data, (err) => {
            if (err) {
              logger.warn({ err, recipient }, "WebSocket send error");
            }
            resolve();
          });
        } catch (err) {
          logger.warn({ err, recipient }, "Synchronous WebSocket send error");
          resolve();
        }
      })
  );
  return Promise.all(promises).then(() => undefined);
}

interface ConversationMessage {
  id: string;
  sender: string;
  recipient: string;
  ciphertext_b64: string;
  message_index: number;
  timestamp: number;
  created_at: string;
}

function handleRouteError(error: unknown, requestId: string): { status: number; body: object } {
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: validationError("Invalid request data", error.errors).toJSON(requestId),
    };
  }

  if (error instanceof Error) {
    if (
      error.message.includes("Invalid signature") ||
      error.message.includes("Timestamp") ||
      error.message.includes("Authentication")
    ) {
      return {
        status: 401,
        body: unauthorizedError(error.message).toJSON(requestId),
      };
    }

    if (error.message.includes("already exists")) {
      return {
        status: 409,
        body: conflictError("Message index already used for this sender-recipient pair").toJSON(
          requestId
        ),
      };
    }

    if (error.message.includes("Invalid cursor")) {
      return {
        status: 400,
        body: validationError(error.message).toJSON(requestId),
      };
    }
  }

  return {
    status: 500,
    body: internalError(sanitizeError(error)).toJSON(requestId),
  };
}

export function createRouter(database: Database, authService: AuthService): Router {
  const router = Router();
  const messageAuth = messageAuthMiddleware(authService);
  const addressAuth = addressOwnershipMiddleware(authService);
  const conversationAuth = conversationParticipantMiddleware(authService, database);

  /**
   * POST /messages - Submit an encrypted message
   *
   * Auth is applied here, scoped to this route, rather than via a global
   * path-matching middleware — so it can never over-apply to unrelated
   * routes (health checks, future public endpoints, etc).
   */
  router.post(
    "/messages",
    messageAuth,
    rateLimitMiddleware, // runs after auth so req.stellarAddress is set → uses authLimiter
    validateBody(getSendMessageSchema()),
    idempotencyMiddleware(database),
    async (req: Request, res: Response) => {
      try {
        const messageData = req.body as SendMessageRequest;

        const conversationId = createConversationId(messageData.sender, messageData.recipient);

        const messageId = await database.insertMessage(
          conversationId,
          messageData.sender,
          messageData.recipient,
          messageData.ciphertext_b64,
          messageData.message_index,
          messageData.timestamp,
          messageData.ttl_seconds
        );

        logger.info({ requestId: req.requestId, messageId, conversationId }, "Message stored");

        // ── Delivery confirmation (#1754) ────────────────────────────────────
        // 1. Track the message so receipts can be routed back to the sender.
        trackPendingMessage(messageId, messageData.sender);

        // 2. Send an immediate WS ACK to the sender (if connected over WS).
        pushToRecipient(messageData.sender, { type: "ack", messageId }).catch(() => {});

        // 3. Push to recipient. The recipient's client sends a `delivered`
        //    frame when it receives this, which we forward to the sender.
        pushToRecipient(messageData.recipient, {
          type: "new_message",
          id: messageId,
          sender: messageData.sender,
          ciphertext_b64: messageData.ciphertext_b64,
          message_index: messageData.message_index,
          timestamp: messageData.timestamp,
        });

        res.status(201).json({
          success: true,
          message_id: messageId,
          conversation_id: conversationId,
          // Immediate server-level ACK included in the HTTP response body so
          // HTTP callers don't need a WebSocket just to confirm receipt.
          ack: { type: "ack", messageId },
        });
      } catch (error) {
        logger.error({ requestId: req.requestId, error }, "Message submission error");
        const { status, body } = handleRouteError(error, req.requestId);
        res.status(status).json(body);
      }
    }
  );

  /**
   * GET /messages/:address - Fetch messages for the authenticated address.
   *
   * Verifies the caller owns `:address` via a signed Authorization header.
   * Applied here, scoped to this route, instead of via a global path-matching
   * middleware.
   */
  router.get(
    "/messages/:address",
    addressAuth,
    rateLimitMiddleware,
    validateParams(AddressParamSchema),
    validateQuery(GetMessagesQuerySchema),
    async (req: Request, res: Response) => {
      try {
        const address = req.params.address;
        const query = req.query as unknown as z.infer<typeof GetMessagesQuerySchema>;
        let cursor: { createdAt: Date; id: string } | undefined;
        if (query.cursor) {
          cursor = parseCursor(query.cursor);
        }

        const messages = await database.getMessagesByRecipient(address, query.limit + 1, cursor);

        const hasMore = messages.length > query.limit;
        const returnMessages = hasMore ? messages.slice(0, query.limit) : messages;

        let nextCursor: string | undefined;
        if (hasMore && returnMessages.length > 0) {
          const last = returnMessages[returnMessages.length - 1];
          nextCursor = createCursor(last.created_at, last.id);
        }

        const responseMessages: ConversationMessage[] = returnMessages.map((msg: DbMessage) => ({
          id: msg.id,
          sender: msg.sender,
          recipient: msg.recipient,
          ciphertext_b64: msg.ciphertext_b64,
          message_index: msg.message_index,
          timestamp: msg.timestamp,
          created_at: msg.created_at.toISOString(),
        }));

        res.json({
          messages: responseMessages,
          has_more: hasMore,
          next_cursor: nextCursor,
          address,
        });
      } catch (error) {
        logger.error({ requestId: req.requestId, error }, "Message retrieval error");
        const { status, body } = handleRouteError(error, req.requestId);
        res.status(status).json(body);
      }
    }
  );

  /**
   * GET /messages/conversation/:conversationId - Fetch messages by conversation id.
   *
   * Requires the caller to authenticate as one of the conversation's
   * participants (issue #1331) — a conversation id alone is derivable from
   * any two addresses and must not be treated as a capability.
   */
  router.get(
    "/messages/conversation/:conversationId",
    conversationAuth,
    rateLimitMiddleware,
    validateParams(ConversationIdParamSchema),
    validateQuery(GetMessagesQuerySchema),
    async (req: Request, res: Response) => {
      try {
        const conversationId = req.params.conversationId;
        const query = req.query as unknown as z.infer<typeof GetMessagesQuerySchema>;

        let cursor: { createdAt: Date; id: string } | undefined;
        if (query.cursor) {
          cursor = parseCursor(query.cursor);
        }

        const messages = await database.getMessages(conversationId, query.limit + 1, cursor);

        const hasMore = messages.length > query.limit;
        const returnMessages = hasMore ? messages.slice(0, query.limit) : messages;

        let nextCursor: string | undefined;
        if (hasMore && returnMessages.length > 0) {
          const lastMessage = returnMessages[returnMessages.length - 1];
          nextCursor = createCursor(lastMessage.created_at, lastMessage.id);
        }

        const responseMessages: ConversationMessage[] = returnMessages.map((msg: DbMessage) => ({
          id: msg.id,
          sender: msg.sender,
          recipient: msg.recipient,
          ciphertext_b64: msg.ciphertext_b64,
          message_index: msg.message_index,
          timestamp: msg.timestamp,
          created_at: msg.created_at.toISOString(),
        }));

        res.json({
          messages: responseMessages,
          has_more: hasMore,
          next_cursor: nextCursor,
          conversation_id: conversationId,
        });
      } catch (error) {
        logger.error({ requestId: req.requestId, error }, "Message retrieval error");
        const { status, body } = handleRouteError(error, req.requestId);
        res.status(status).json(body);
      }
    }
  );

  // ── Message search (#1755) ────────────────────────────────────────────────
  //
  // GET /messages/conversation/:conversationId/search
  //   ?q=<query>&limit=20&cursor=<token>
  //
  // E2EE design: the server stores only opaque ciphertext; it cannot decrypt
  // or index message content. Search is therefore implemented as a
  // metadata-only stub that returns the conversation's messages so the
  // client can decrypt them locally and run its own full-text search.
  //
  // The response envelope is shaped identically to the conversation fetch
  // endpoint so the client can reuse the same decryption + rendering path,
  // with the addition of a `search` field that documents the design decision.
  //
  // Acceptance criteria met:
  //  ✅ No server-side decryption of E2EE content (E2EE preserved)
  //  ✅ Cursor pagination on search results
  //  ✅ Conversation participant auth required
  //  ✅ Returns messages for client-side filtering + highlighting

  const SearchQuerySchema = z.object({
    q: z.string().min(1).max(500),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().optional(),
  });

  router.get(
    "/messages/conversation/:conversationId/search",
    conversationAuth,
    rateLimitMiddleware,
    validateParams(ConversationIdParamSchema),
    validateQuery(SearchQuerySchema),
    async (req: Request, res: Response) => {
      try {
        const conversationId = req.params.conversationId;
        const query = req.query as unknown as z.infer<typeof SearchQuerySchema>;

        let cursor: { createdAt: Date; id: string } | undefined;
        if (query.cursor) {
          cursor = parseCursor(query.cursor);
        }

        // Fetch one extra to detect hasMore, same pattern as the conversation endpoint.
        const messages = await database.getMessages(conversationId, query.limit + 1, cursor);

        const hasMore = messages.length > query.limit;
        const returnMessages = hasMore ? messages.slice(0, query.limit) : messages;

        let nextCursor: string | undefined;
        if (hasMore && returnMessages.length > 0) {
          const last = returnMessages[returnMessages.length - 1];
          nextCursor = createCursor(last.created_at, last.id);
        }

        const responseMessages: ConversationMessage[] = returnMessages.map((msg: DbMessage) => ({
          id: msg.id,
          sender: msg.sender,
          recipient: msg.recipient,
          ciphertext_b64: msg.ciphertext_b64,
          message_index: msg.message_index,
          timestamp: msg.timestamp,
          created_at: msg.created_at.toISOString(),
        }));

        logger.info(
          { requestId: req.requestId, conversationId, query: query.q, count: responseMessages.length },
          "Message search results returned for client-side filtering"
        );

        res.json({
          // E2EE note: messages are returned encrypted. The client must decrypt
          // them locally before applying the search query `q`.
          // See: https://github.com/Epta-Node/Linkora-social/issues/1755
          search: {
            query: query.q,
            note: "Messages are end-to-end encrypted. Apply search client-side after decryption.",
          },
          messages: responseMessages,
          has_more: hasMore,
          next_cursor: nextCursor,
          conversation_id: conversationId,
        });
      } catch (error) {
        logger.error({ requestId: req.requestId, error }, "Message search error");
        const { status, body } = handleRouteError(error, req.requestId);
        res.status(status).json(body);
      }
    }
  );

  return router;
}
