/**
 * API routes for the DM relay service.
 */

import { Router, Request, Response } from "express";
import { WebSocket } from "ws";
import { Database, DbMessage } from "./database";
import { AuthService } from "./auth";
import {
  SendMessageSchema,
  GetMessagesQuerySchema,
  ConversationIdSchema,
  parseCursor,
  createCursor,
} from "./validation";
import { createConversationId, sanitizeError } from "./utils";
import { ZodError } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { logger } from "./logger";

// ── WebSocket client registry (address → set of sockets) ─────────────────────

const wsClients = new Map<string, Set<WebSocket>>();

export function registerWsClient(address: string, ws: WebSocket): void {
  if (!wsClients.has(address)) wsClients.set(address, new Set());
  wsClients.get(address)!.add(ws);

  ws.on("message", (data) => {
    try {
      const payload = JSON.parse(data.toString());
      if (payload.type === "typing_status" && typeof payload.recipient === "string") {
        // Force the sender to be the address tied to this websocket connection
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

// ─────────────────────────────────────────────────────────────────────────────

interface ConversationMessage {
  id: string;
  sender: string;
  recipient: string;
  ciphertext_b64: string;
  message_index: number;
  timestamp: number;
  created_at: string;
}

export function createRouter(database: Database, _authService: AuthService): Router {
  const router = Router();

  /**
   * POST /messages - Submit an encrypted message
   */
  router.post("/messages", async (req: Request, res: Response) => {
    try {
      const messageData = SendMessageSchema.parse(req.body);

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

      // Push to recipient if online
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
      logger.error({ requestId: req.requestId, err: error }, "Message submission error");

      if (error instanceof ZodError) {
        return res.status(400).json({
          error: "Validation Error",
          message: "Invalid request data",
          details: error.errors,
          requestId: req.requestId,
        });
      }

      if (error instanceof Error) {
        if (
          error.message.includes("Invalid signature") ||
          error.message.includes("Timestamp") ||
          error.message.includes("Authentication")
        ) {
          return res.status(401).json({
            error: "Authentication Failed",
            message: error.message,
            requestId: req.requestId,
          });
        }

        if (error.message.includes("already exists")) {
          return res.status(409).json({
            error: "Conflict",
            message: "Message index already used for this sender-recipient pair",
            requestId: req.requestId,
          });
        }
      }

      res.status(500).json({
        error: "Internal Server Error",
        message: sanitizeError(error),
        requestId: req.requestId,
      });
    }
  });

  /**
   * GET /messages/:address - Retrieve all messages for a recipient address
   */
  router.get("/messages/:address", async (req: Request, res: Response) => {
    try {
      const address = req.params.address;
      if (!StrKey.isValidEd25519PublicKey(address)) {
        return res.status(400).json({
          error: "Validation Error",
          message: "Invalid Stellar address format",
          requestId: req.requestId,
        });
      }

      const query = GetMessagesQuerySchema.parse(req.query);
      let beforeDate: Date | undefined;
      if (query.cursor) {
        beforeDate = parseCursor(query.cursor);
      }

      const messages = await database.getMessagesByRecipient(address, query.limit + 1, beforeDate);

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
      logger.error({ requestId: req.requestId, err: error }, "Message retrieval error");

      if (error instanceof ZodError) {
        return res.status(400).json({
          error: "Validation Error",
          message: "Invalid query parameters",
          details: error.errors,
          requestId: req.requestId,
        });
      }

      if (error instanceof Error && error.message.includes("Invalid cursor")) {
        return res.status(400).json({
          error: "Invalid Cursor",
          message: error.message,
          requestId: req.requestId,
        });
      }

      res.status(500).json({
        error: "Internal Server Error",
        message: sanitizeError(error),
        requestId: req.requestId,
      });
    }
  });

  /**
   * GET /messages/conversation/:conversationId - Retrieve messages for a conversation
   */
  router.get("/messages/conversation/:conversationId", async (req: Request, res: Response) => {
    try {
      const conversationId = ConversationIdSchema.parse(req.params.conversationId);
      const query = GetMessagesQuerySchema.parse(req.query);

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
      logger.error({ requestId: req.requestId, err: error }, "Message retrieval error");

      if (error instanceof ZodError) {
        return res.status(400).json({
          error: "Validation Error",
          message: "Invalid conversation ID or query parameters",
          details: error.errors,
          requestId: req.requestId,
        });
      }

      if (error instanceof Error && error.message.includes("Invalid cursor")) {
        return res.status(400).json({
          error: "Invalid Cursor",
          message: error.message,
          requestId: req.requestId,
        });
      }

      res.status(500).json({
        error: "Internal Server Error",
        message: sanitizeError(error),
        requestId: req.requestId,
      });
    }
  });

  /**
   * GET /health - Health check endpoint
   */
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
      logger.error({ requestId: req.requestId, err: error }, "Health check error");

      res.status(503).json({
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: sanitizeError(error),
        requestId: req.requestId,
      });
    }
  });

  return router;
}
