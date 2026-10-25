import { Skeleton, cx } from "./Skeleton";

export interface PostCardSkeletonProps {
  className?: string;
}

/**
 * Mirrors `<PostCard />`: author/date header, three lines of body copy and
 * the like/tip action row, using the same padding, borders and type heights
 * so swapping skeleton → content does not shift the layout.
 */
export function PostCardSkeleton({ className }: PostCardSkeletonProps) {
  return (
    <div
      data-testid="post-card-skeleton"
      aria-hidden="true"
      className={cx(
        "rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3 shadow-lg md:p-4 lg:p-5",
        className
      )}
    >
      {/* Author (text-sm) + date (text-xs) */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Skeleton width="7rem" height="1.25rem" />
        <Skeleton width="5rem" height="1rem" />
      </div>

      {/* Body copy: text-base / leading-relaxed ≈ 26px per line */}
      <div className="mb-4 space-y-3">
        <Skeleton width="100%" height="1.625rem" />
        <Skeleton width="82%" height="1.625rem" />
        <Skeleton width="64%" height="1.625rem" />
      </div>

      {/* Like / tip actions */}
      <div className="flex items-center gap-6 border-t border-[var(--border)]/40 pt-3">
        <Skeleton width="3.5rem" height="1.75rem" />
        <Skeleton width="6rem" height="1.75rem" />
      </div>
    </div>
  );
}
