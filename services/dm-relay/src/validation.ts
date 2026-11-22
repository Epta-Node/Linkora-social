import { z } from "zod";
import {
  stellarAddressSchema,
  base64Schema,
  hex64BytesSchema,
  conversationIdSchema,
} from "@linkora/types/src/schemas";

export const DEFAULT_MAX_MESSAGE_BYTES = 64 * 1024; // 64 KB

export function getMaxMessageBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MAX_MESSAGE_BYTES || env.MAX_MESSAGE_SIZE;
  if (!raw) return DEFAULT_MAX_MESSAGE_BYTES;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) || parsed <= 0 ? DEFAULT_MAX_MESSAGE_BYTES : parsed;
}

export function createSendMessageSchema(maxBytes: number = getMaxMessageBytes()) {
  const maxBase64Chars = Math.ceil(maxBytes / 3) * 4 + 4;
  return z.object({
    sender: stellarAddressSchema,
    recipient: stellarAddressSchema,
    ciphertext_b64: base64Schema.min(1).refine(
      (val) => {
        if (val.length > maxBase64Chars) return false;
        return Buffer.from(val, "base64").length <= maxBytes;
      },
      {
        message: `Ciphertext size exceeds maximum allowed size of ${maxBytes} bytes`,
      }
    ),
    message_index: z.number().int().min(0).max(2147483647),
    timestamp: z.number().int().positive(),
    signature: hex64BytesSchema,
  });
}

// #1530 — Lazy schema factory. The old `const SendMessageSchema =
// createSendMessageSchema()` was evaluated at import time, which happens
// during `server.ts`'s own import resolution — before its `dotenv.config()`
// call.  The configured MAX_MESSAGE_BYTES was never seen.  Callers that
// need the schema should call `getSendMessageSchema()` after config is loaded.
let _sendMessageSchema: z.ZodObject<any> | null = null;

export function getSendMessageSchema(maxBytes?: number): z.ZodObject<any> {
  if (!_sendMessageSchema || maxBytes !== undefined) {
    _sendMessageSchema = createSendMessageSchema(maxBytes ?? getMaxMessageBytes());
  }
  return _sendMessageSchema;
}

/**
 * @deprecated Use `getSendMessageSchema()` instead. Kept only so that
 * existing test imports don't break.
 */
export const SendMessageSchema = createSendMessageSchema();

export const GetMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const ConversationIdSchema = conversationIdSchema;

export const AddressParamSchema = z.object({
  address: stellarAddressSchema,
});

export const ConversationIdParamSchema = z.object({
  conversationId: conversationIdSchema,
});

export type SendMessageRequest = z.infer<typeof SendMessageSchema>;
export type GetMessagesQuery = z.infer<typeof GetMessagesQuerySchema>;

/**
 * #1529 — Composite cursor carrying both timestamp and id for tiebreaking.
 * Messages written in the same transaction share an identical created_at,
 * so a strict `created_at <` cursor can skip an entire group.  The cursor
 * now encodes "created_at < $ts OR (created_at = $ts AND id < $id)".
 */
export interface CursorParts {
  createdAt: Date;
  id: string;
}

export function parseCursor(cursor: string): CursorParts {
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf-8");
    const [tsStr, id] = decoded.split("|", 2);
    const date = new Date(tsStr);

    if (isNaN(date.getTime()) || !id) {
      throw new Error("Invalid cursor content");
    }

    return { createdAt: date, id };
  } catch (error) {
    throw new Error("Invalid cursor format");
  }
}

export function createCursor(date: Date, id: string): string {
  return Buffer.from(`${date.toISOString()}|${id}`).toString("base64");
}
