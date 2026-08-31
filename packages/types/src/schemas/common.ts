import { z } from "zod";

export const stellarAddressSchema = z
  .string()
  .regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar address format");

export const cursorPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.coerce.number().optional(),
});

export const offsetPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const numericIdStringSchema = z.string().regex(/^\d+$/, "id must be a non-negative integer");

export const base64Schema = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, "Invalid base64 format");

export const hex64BytesSchema = z.string().regex(/^[a-fA-F0-9]{128}$/, "Invalid signature format");

export const conversationIdSchema = z
  .string()
  .regex(/^[a-fA-F0-9]{64}$/, "Invalid conversation ID format (must be 64-char hex)");
