/**
 * API routes for the DM relay service.
 */

import { Router, Request, Response } from 'express';
import { Database, DbMessage } from './database';
import { AuthService } from './auth';
import { 
  SendMessageSchema, 
  GetMessagesQuerySchema, 
  ConversationIdSchema,
  parseCursor,
  createCursor 
} from './validation';
import { createConversationId, sanitizeError } from './utils';
import { ZodError } from 'zod';

interface ConversationMessage {
  id: string;
  sender: string;
  recipient: string;
  ciphertext_b64: string;
  message_index: number;
  timestamp: number;
  created_at: string;
}

export function createRouter(database: Database, authService: AuthService): Router {
  const router = Router();

  /**
   * POST /messages - Submit an encrypted message
   */
  router.post('/messages', async (req: Request, res: Response) => {
    try {
      // Validate request body
      const messageData = SendMessageSchema.parse(req.body);
      
      // Verify authentication
      authService.verifyMessageAuth({
        sender: messageData.sender,
        timestamp: messageData.timestamp,
        signature: messageData.signature,
      });

      // Create conversation ID
      const conversationId = createConversationId(messageData.sender, messageData.recipient);

      // Store message in database
      const messageId = await database.insertMessage(
        conversationId,
        messageData.sender,
        messageData.recipient,
        messageData.ciphertext_b64,
        messageData.message_index,
        messageData.timestamp
      );

      console.log(`[${req.requestId}] Message stored: ${messageId} (conversation: ${conversationId})`);

      res.status(201).json({
        success: true,
        message_id: messageId,
        conversation_id: conversationId,
      });

    } catch (error) {
      console.error(`[${req.requestId}] Message submission error:`, error);

      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid request data',
          details: error.errors,
          requestId: req.requestId,
        });
      }

      if (error instanceof Error) {
        if (error.message.includes('Invalid signature') || error.message.includes('Timestamp')) {
          return res.status(401).json({
            error: 'Authentication Failed',
            message: error.message,
            requestId: req.requestId,
          });
        }

        if (error.message.includes('already exists')) {
          return res.status(409).json({
            error: 'Conflict',
            message: 'Message index already used for this sender-recipient pair',
            requestId: req.requestId,
          });
        }
      }

      res.status(500).json({
        error: 'Internal Server Error',
        message: sanitizeError(error),
        requestId: req.requestId,
      });
    }
  });

  /**
   * GET /messages/:conversationId - Retrieve messages for a conversation
   */
  router.get('/messages/:conversationId', async (req: Request, res: Response) => {
    try {
      // Validate conversation ID format
      const conversationId = ConversationIdSchema.parse(req.params.conversationId);
      
      // Validate query parameters
      const query = GetMessagesQuerySchema.parse(req.query);

      // Parse cursor if provided
      let beforeDate: Date | undefined;
      if (query.cursor) {
        beforeDate = parseCursor(query.cursor);
      }

      // Fetch messages from database
      const messages = await database.getMessages(
        conversationId,
        query.limit + 1, // Fetch one extra to check if there are more
        beforeDate
      );

      // Determine if there are more messages
      const hasMore = messages.length > query.limit;
      const returnMessages = hasMore ? messages.slice(0, query.limit) : messages;

      // Create next cursor if there are more messages
      let nextCursor: string | undefined;
      if (hasMore && returnMessages.length > 0) {
        const lastMessage = returnMessages[returnMessages.length - 1];
        nextCursor = createCursor(lastMessage.created_at);
      }

      // Transform messages for API response
      const responseMessages: ConversationMessage[] = returnMessages.map((msg: DbMessage) => ({
        id: msg.id,
        sender: msg.sender,
        recipient: msg.recipient,
        ciphertext_b64: msg.ciphertext_b64,
        message_index: msg.message_index,
        timestamp: msg.timestamp,
        created_at: msg.created_at.toISOString(),
      }));

      console.log(`[${req.requestId}] Retrieved ${responseMessages.length} messages for conversation ${conversationId}`);

      res.json({
        messages: responseMessages,
        has_more: hasMore,
        next_cursor: nextCursor,
        conversation_id: conversationId,
      });

    } catch (error) {
      console.error(`[${req.requestId}] Message retrieval error:`, error);

      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid conversation ID or query parameters',
          details: error.errors,
          requestId: req.requestId,
        });
      }

      if (error instanceof Error && error.message.includes('Invalid cursor')) {
        return res.status(400).json({
          error: 'Invalid Cursor',
          message: error.message,
          requestId: req.requestId,
        });
      }

      res.status(500).json({
        error: 'Internal Server Error',
        message: sanitizeError(error),
        requestId: req.requestId,
      });
    }
  });

  /**
   * GET /health - Health check endpoint
   */
  router.get('/health', async (req: Request, res: Response) => {
    try {
      const stats = await database.getHealthStats();
      
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: {
          connected: true,
          total_messages: stats.totalMessages,
          messages_last_24h: stats.messagesLast24h,
          oldest_message: stats.oldestMessage?.toISOString(),
        },
        service: {
          name: 'linkora-dm-relay',
          version: '0.1.0',
          uptime: process.uptime(),
        },
      });
    } catch (error) {
      console.error(`[${req.requestId}] Health check error:`, error);
      
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: sanitizeError(error),
        requestId: req.requestId,
      });
    }
  });

  return router;
}