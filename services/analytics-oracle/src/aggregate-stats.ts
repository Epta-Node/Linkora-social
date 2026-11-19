import { z } from "zod";

/** Aggregate window posted by the analytics oracle every six hours. */
export const AggregateStats24hSchema = z.object({
  totalPosts24h: z.number().int().nonnegative(),
  totalTips24h: z.string().regex(/^\d+$/),
  topCreator24h: z.string().min(1),
  windowEndedAt: z.string().datetime(),
});

export type AggregateStats24h = z.infer<typeof AggregateStats24hSchema>;

export const DEFAULT_AGGREGATE_POST_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Convert the service model to the Soroban contract field names. */
export function toContractAggregate(stats: AggregateStats24h) {
  const parsed = AggregateStats24hSchema.parse(stats);
  return {
    total_posts_24h: parsed.totalPosts24h,
    total_tips_24h: parsed.totalTips24h,
    top_creator_24h: parsed.topCreator24h,
    window_ended_at: parsed.windowEndedAt,
  } as const;
}
