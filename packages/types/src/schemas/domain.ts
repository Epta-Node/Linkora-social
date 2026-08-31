import { z } from "zod";
import { stellarAddressSchema } from "./common";

export const ProfileSchema = z.object({
  address: stellarAddressSchema,
  username: z.string().min(3).max(50),
  creator_token: stellarAddressSchema.nullable(),
});

export const PostSchema = z.object({
  id: z.union([z.string(), z.bigint()]),
  author: stellarAddressSchema,
  content: z.string().max(2000),
  tip_total: z.union([z.string(), z.bigint()]),
  like_count: z.union([z.number().int().nonnegative(), z.bigint()]),
  timestamp: z.union([z.number().int().nonnegative(), z.bigint()]),
});

export const PoolSchema = z.object({
  token: stellarAddressSchema,
  balance: z.union([z.bigint(), z.string()]),
  threshold: z.number().int().min(1),
  admins: z.array(stellarAddressSchema),
});

export const GovernanceProposalSchema = z.object({
  id: z.union([z.string(), z.bigint()]),
  pool_id: z.string(),
  proposer: stellarAddressSchema,
  recipient: stellarAddressSchema,
  amount: z.union([z.bigint(), z.string()]),
  signers: z.array(stellarAddressSchema),
  status: z.enum(["Open", "Executed", "Rejected"]),
});

export const ReportSchema = z.object({
  id: z.union([z.string(), z.bigint()]),
  reporter: stellarAddressSchema,
  reported: stellarAddressSchema,
  reason: z.string().max(500),
  created_at: z.string().datetime(),
});

export type ProfileInput = z.input<typeof ProfileSchema>;
export type PostInput = z.input<typeof PostSchema>;
export type PoolInput = z.input<typeof PoolSchema>;
export type GovernanceProposalInput = z.input<typeof GovernanceProposalSchema>;
export type ReportInput = z.input<typeof ReportSchema>;
