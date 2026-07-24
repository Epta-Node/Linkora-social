import { z } from "zod";
import {
  stellarAddressSchema,
  base64Schema,
  hex64BytesSchema,
  conversationIdSchema,
} from "@linkora/types/src/schemas";

export const SendMessageSchema = z.object({
  sender: stellarAddressSchema,
  recipient: stellarAddressSchema,
  ciphertext_b64: base64Schema.min(1),
  message_index: z.number().int().min(0).max(2147483647),
  timestamp: z.number().int().positive(),
  signature: hex64BytesSchema,
});

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

export function parseCursor(cursor: string): Date {
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf-8");
    const date = new Date(decoded);

    if (isNaN(date.getTime())) {
      throw new Error("Invalid date in cursor");
    }

    return date;
  } catch (error) {
    throw new Error("Invalid cursor format");
  }
}

export function createCursor(date: Date): string {
  return Buffer.from(date.toISOString()).toString("base64");
}
