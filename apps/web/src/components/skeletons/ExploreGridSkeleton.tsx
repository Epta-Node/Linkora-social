import { Skeleton, cx } from "./Skeleton";

export interface ExploreGridSkeletonProps {
  /** Number of result placeholders to show while the search runs. */
  count?: number;
  className?: string;
}

/**
 * Loading state for the explore results grid. Uses the identical grid
 * container and card shell as the loaded results (`grid-cols-1 gap-4` with
 * bordered cards) so results drop straight in without shifting the page.
 */
export function ExploreGridSkeleton({ count = 4, className }: ExploreGridSkeletonProps) {
  const visibleCount = Math.min(Math.max(Math.floor(count) || 4, 1), 8);

  return (
    <div
      data-testid="explore-grid-skeleton"
      role="status"
      aria-busy="true"
      aria-label="Loading explore results"
      className={cx("grid grid-cols-1 gap-4", className)}
    >
      {Array.from({ length: visibleCount }, (_, index) => (
        <ExploreCardSkeleton key={index} />
      ))}
    </div>
  );
}

function ExploreCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:p-6"
    >
      {/* Author + date (text-sm / text-xs) */}
      <div className="mb-2 flex items-start justify-between">
        <Skeleton width="8rem" height="1.25rem" />
        <Skeleton width="6rem" height="1rem" />
      </div>

      {/* Post excerpt (text-base) */}
      <Skeleton width="100%" height="1.5rem" className="mb-2" />

      {/* Tips summary (text-sm) */}
      <Skeleton width="6rem" height="1.25rem" />
    </div>
  );
}
