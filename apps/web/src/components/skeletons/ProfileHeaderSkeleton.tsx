import { Skeleton, cx } from "./Skeleton";

export interface ProfileHeaderSkeletonProps {
  className?: string;
}

/**
 * Mirrors the `#profile-header` section on the profile page: 96px avatar,
 * username, address line, follower/following counts and the action buttons,
 * with the same shell (padding, radius, border, background) as the loaded
 * header so the profile paints without a layout jump.
 */
export function ProfileHeaderSkeleton({ className }: ProfileHeaderSkeletonProps) {
  return (
    <section
      data-testid="profile-header-skeleton"
      role="status"
      aria-busy="true"
      aria-label="Loading profile header"
      className={cx(
        "flex flex-col items-start gap-4 rounded-2xl border border-[var(--bg-tertiary)] bg-[var(--bg-secondary)] p-4 md:flex-row md:items-center md:gap-6 md:p-6",
        className
      )}
    >
      {/* Avatar (96×96 incl. 4px ring) */}
      <Skeleton
        width="6rem"
        height="6rem"
        radius="var(--radius-full)"
        className="border-4 border-[var(--bg-primary)]"
      />

      {/* Username, address and counts */}
      <div className="min-w-0 flex-1">
        <Skeleton width="14rem" height="2.25rem" radius="var(--radius-lg)" className="max-w-full" />
        <Skeleton width="16rem" height="1.25rem" className="mt-2 max-w-full" />
        <div className="mt-4 flex gap-6">
          <Skeleton width="7rem" height="1.25rem" />
          <Skeleton width="7rem" height="1.25rem" />
        </div>
      </div>

      {/* Follow button + overflow menu trigger */}
      <div className="mt-4 flex w-full shrink-0 flex-wrap items-center gap-2 md:mt-0 md:w-auto">
        <Skeleton height="2.5rem" radius="var(--radius-full)" className="w-full sm:w-32" />
        <Skeleton width="2.5rem" height="2.5rem" radius="var(--radius-full)" />
      </div>
    </section>
  );
}
