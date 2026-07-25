import { Router, Request, Response } from "express";
import { WebSocket } from "ws";
import { Database, DbMessage } from "./database";
import { AuthService } from "./auth";
import { validateBody, validateQuery, validateParams } from "./middleware/validate";
import {
  SendMessageSchema,
  GetMessagesQuerySchema,
  AddressParamSchema,
  ConversationIdParamSchema,
  parseCursor,
  createCursor,
} from "./validation";
import { createConversationId, sanitizeError } from "./utils";
import { z, ZodError } from "zod";
import { idempotencyMiddleware } from "./middleware/idempotency";
import {
  validationError,
  unauthorizedError,
  conflictError,
  internalError,
} from "@linkora/types/src/errors";

// ── WebSocket client registry (address → set of sockets) ─────────────────────

const wsClients = new Map<string, Set<WebSocket>>();

export function registerWsClient(address: string, ws: WebSocket): void {
  if (!wsClients.has(address)) wsClients.set(address, new Set());
  wsClients.get(address)!.add(ws);

  ws.on("message", (data) => {
    try {
      const payload = JSON.parse(data.toString());
      if (payload.type === "typing_status" && typeof payload.recipient === "string") {
        pushToRecipient(payload.recipient, {
          type: "typing_status",
          sender: address,
        });
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

function pushToRecipient(recipient: string, payload: object): void {
  const sockets = wsClients.get(recipient);
  if (!sockets) return;
  const data = JSON.stringify(payload);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
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

export function createRouter(database: Database, _authService: AuthService): Router {
  const router = Router();

  /**
   * POST /messages - Submit an encrypted message
   */
  router.post(
    "/messages",
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

        console.log(
          `[${req.requestId}] Message stored: ${messageId} (conversation: ${conversationId})`
        );

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
        console.error(`[${req.requestId}] Message submission error:`, error);
        const { status, body } = handleRouteError(error, req.requestId);
        res.status(status).json(body);
      }
    }
  );

  router.get(
    "/messages/:address",
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
        console.error(`[${req.requestId}] Message retrieval error:`, error);
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
        console.error(`[${req.requestId}] Message retrieval error:`, error);
        const { status, body } = handleRouteError(error, req.requestId);
        res.status(status).json(body);
      }
    }
  );

  router.get("/health", async (req: Request, res: Response) => {
    try {
      const stats = await database.getHealthStats();

      res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        database: {
          connected: true,
          total_messages: stats.totalMessages,
          messages_last_24h: stats.messagesLast24h,
          oldest_message: stats.oldestMessage?.toISOString(),
        },
        service: {
          name: "linkora-dm-relay",
          version: "0.1.0",
          uptime: process.uptime(),
          ws_connected_clients: [...wsClients.values()].reduce((sum, s) => sum + s.size, 0),
        },
      });
    } catch (error) {
      console.error(`[${req.requestId}] Health check error:`, error);

      res.status(503).json({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: sanitizeError(error),
          requestId: req.requestId,
        },
      });
    }
  });

  return router;
}
