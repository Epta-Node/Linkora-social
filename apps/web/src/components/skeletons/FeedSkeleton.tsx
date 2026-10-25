import { PostCardSkeleton } from "./PostCardSkeleton";
import { cx } from "./Skeleton";

export interface FeedSkeletonProps {
  /** Number of stacked post placeholders — 3–5 matches a typical feed page. */
  count?: number;
  className?: string;
}

/**
 * Loading state for feed-style lists: a stack of `PostCardSkeleton`s inside
 * the same `space-y-4` rhythm the real posts use.
 */
export function FeedSkeleton({ count = 3, className }: FeedSkeletonProps) {
  const visibleCount = Math.min(Math.max(Math.floor(count) || 3, 3), 5);

  return (
    <div
      data-testid="feed-skeleton"
      role="status"
      aria-busy="true"
      aria-label="Loading feed"
      className={cx("space-y-4", className)}
    >
      {Array.from({ length: visibleCount }, (_, index) => (
        <PostCardSkeleton key={index} />
      ))}
    </div>
  );
}
