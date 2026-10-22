import { Skeleton, cx } from "./Skeleton";

export interface NotificationItemSkeletonProps {
  className?: string;
}

/**
 * Mirrors `NotificationRow`: unread dot, message line (text-sm) and timestamp
 * (text-xs) inside the same bordered, padded row as a real notification.
 */
export function NotificationItemSkeleton({ className }: NotificationItemSkeletonProps) {
  return (
    <li
      data-testid="notification-item-skeleton"
      aria-hidden="true"
      className={cx(
        "flex items-start gap-4 rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-5 py-4",
        className
      )}
    >
      {/* Unread indicator dot */}
      <Skeleton width="0.625rem" height="0.625rem" radius="var(--radius-full)" className="mt-1" />

      <div className="min-w-0 flex-1">
        <Skeleton width="75%" height="1.25rem" />
        <Skeleton width="4rem" height="1rem" className="mt-1" />
      </div>
    </li>
  );
}
