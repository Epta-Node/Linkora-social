import { Router, Request, Response } from "express";
import { WebSocket } from "ws";
import { Database, DbMessage } from "./database";
import { AuthService } from "./auth";
import { messageAuthMiddleware, addressOwnershipMiddleware } from "./middleware/auth";
import { validateBody, validateQuery, validateParams } from "./middleware/validate";
import {
  SendMessageSchema,
  GetMessagesQuerySchema,
  AddressParamSchema,
  ConversationIdParamSchema,
  parseCursor,
  createCursor,
  getMaxMessageBytes,
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

const CLOSE_MESSAGE_TOO_LARGE = 1009;

const wsClients = new Map<string, Set<WebSocket>>();
const typingRateLimitMap = new Map<string, number>();

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
        const lastSent = typingRateLimitMap.get(rateLimitKey) || 0;
        const now = Date.now();
        if (now - lastSent < 3000) {
          logger.warn(
            { authenticatedAddress: address, recipient },
            "Typing notification rate limit exceeded"
          );
          return;
        }
        typingRateLimitMap.set(rateLimitKey, now);

        // Track this DB write so the shutdown handler can wait for it.
        inflightCounter?.increment();
        // typing_status is push-only and does not touch the DB directly,
        // so decrement immediately after dispatching.
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
    idempotencyMiddleware(database),
    validateBody(SendMessageSchema),
    async (req: Request, res: Response) => {
      try {
        const messageData = req.body as z.infer<typeof SendMessageSchema>;

        const conversationId = createConversationId(messageData.sender, messageData.recipient);

        const messageId = await database.insertMessage(
          conversationId,
          messageData.sender,
          messageData.recipient,
          messageData.ciphertext_b64,
          messageData.message_index,
          messageData.timestamp
        );

        logger.info({ requestId: req.requestId, messageId, conversationId }, "Message stored");

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
    validateParams(AddressParamSchema),
    validateQuery(GetMessagesQuerySchema),
    async (req: Request, res: Response) => {
      try {
        const address = req.params.address;
        const query = req.query as unknown as z.infer<typeof GetMessagesQuerySchema>;
        let beforeDate: Date | undefined;
        if (query.cursor) {
          beforeDate = parseCursor(query.cursor);
        }

        const messages = await database.getMessagesByRecipient(
          address,
          query.limit + 1,
          beforeDate
        );

        const hasMore = messages.length > query.limit;
        const returnMessages = hasMore ? messages.slice(0, query.limit) : messages;

        let nextCursor: string | undefined;
        if (hasMore && returnMessages.length > 0) {
          const last = returnMessages[returnMessages.length - 1];
          nextCursor = createCursor(last.created_at);
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

  router.get(
    "/messages/conversation/:conversationId",
    validateParams(ConversationIdParamSchema),
    validateQuery(GetMessagesQuerySchema),
    async (req: Request, res: Response) => {
      try {
        const conversationId = req.params.conversationId;
        const query = req.query as unknown as z.infer<typeof GetMessagesQuerySchema>;

        let beforeDate: Date | undefined;
        if (query.cursor) {
          beforeDate = parseCursor(query.cursor);
        }

        const messages = await database.getMessages(conversationId, query.limit + 1, beforeDate);

        const hasMore = messages.length > query.limit;
        const returnMessages = hasMore ? messages.slice(0, query.limit) : messages;

        let nextCursor: string | undefined;
        if (hasMore && returnMessages.length > 0) {
          const lastMessage = returnMessages[returnMessages.length - 1];
          nextCursor = createCursor(lastMessage.created_at);
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

  return router;
}
