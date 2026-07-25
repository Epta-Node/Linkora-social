"use client";

import { useRef, useState, type ReactNode, type TouchEvent } from "react";
import { MasonryGrid } from "@/components/cards/MasonryGrid";

interface MobileFeedProps {
  children: ReactNode;
  onRefresh: () => void | Promise<void>;
  refreshing?: boolean;
  columns?: number;
}

const PULL_THRESHOLD = 64;
const MAX_PULL = 96;

export function MobileFeed({
  children,
  onRefresh,
  refreshing = false,
  columns = 2,
}: MobileFeedProps) {
  const [pullDistance, setPullDistance] = useState(0);
  const startYRef = useRef<number | null>(null);
  const pullingRef = useRef(false);

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (refreshing || window.scrollY > 0) return;
    startYRef.current = event.touches[0].clientY;
    pullingRef.current = true;
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (!pullingRef.current || startYRef.current === null) return;
    const delta = event.touches[0].clientY - startYRef.current;
    if (delta <= 0) {
      setPullDistance(0);
      return;
    }
    event.preventDefault();
    setPullDistance(Math.min(delta * 0.5, MAX_PULL));
  };

  const handleTouchEnd = () => {
    if (pullingRef.current && pullDistance >= PULL_THRESHOLD) {
      void onRefresh();
    }
    pullingRef.current = false;
    startYRef.current = null;
    setPullDistance(0);
  };

  const indicatorProgress = Math.min(pullDistance / PULL_THRESHOLD, 1);

  return (
    <div
      className="md:hidden"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className="flex items-center justify-center overflow-hidden transition-[height] duration-200"
        style={{ height: refreshing ? 40 : pullDistance }}
        aria-hidden={!refreshing && pullDistance === 0}
      >
        <svg
          className={
            refreshing
              ? "h-5 w-5 animate-spin text-[var(--color-info)]"
              : "h-5 w-5 text-[var(--color-info)]"
          }
          style={
            refreshing
              ? undefined
              : { transform: `rotate(${indicatorProgress * 360}deg)`, opacity: indicatorProgress }
          }
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      </div>

      <MasonryGrid columns={columns}>{children}</MasonryGrid>
    </div>
  );
}
