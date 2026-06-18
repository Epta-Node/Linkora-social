/**
 * Request validation schemas using Zod.
 */

import { z } from 'zod';

// Stellar address format validation
const stellarAddressSchema = z.string().regex(
  /^G[A-Z2-7]{55}$/,
  'Invalid Stellar address format'
);

// Base64 validation
const base64Schema = z.string().regex(
  /^[A-Za-z0-9+/]*={0,2}$/,
  'Invalid base64 format'
);

// Hex signature validation (64 bytes = 128 hex chars)
const signatureSchema = z.string().regex(
  /^[a-fA-F0-9]{128}$/,
  'Invalid signature format'
);

export const SendMessageSchema = z.object({
  sender: stellarAddressSchema,
  recipient: stellarAddressSchema,
  ciphertext_b64: base64Schema.min(1),
  message_index: z.number().int().min(0).max(2147483647), // PostgreSQL INT max
  timestamp: z.number().int().positive(),
  signature: signatureSchema,
});

export const GetMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const ConversationIdSchema = z.string().regex(
  /^[a-fA-F0-9]{64}$/,
  'Invalid conversation ID format (must be 64-char hex)'
);

export type SendMessageRequest = z.infer<typeof SendMessageSchema>;
export type GetMessagesQuery = z.infer<typeof GetMessagesQuerySchema>;

/**
 * Validate and parse cursor for pagination.
 * Cursor format: base64-encoded ISO timestamp
 */
export function parseCursor(cursor: string): Date {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const date = new Date(decoded);
    
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date in cursor');
    }
    
    return date;
  } catch (error) {
    throw new Error('Invalid cursor format');
  }
}

/**
 * Create a cursor for pagination.
 */
export function createCursor(date: Date): string {
  return Buffer.from(date.toISOString()).toString('base64');
}