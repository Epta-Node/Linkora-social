"use client";

import { Children, isValidElement, type ReactNode } from "react";

interface MasonryGridProps {
  children: ReactNode;
  /**
   * Fixed column count. When omitted the grid is responsive:
   * 1 column on mobile, 2 on tablets (768px+), 3 on desktops (1024px+).
   */
  columns?: number;
  gap?: number;
  className?: string;
}

/** Tailwind `md` (768px) and `lg` (1024px) breakpoints. */
export const RESPONSIVE_COLUMN_CLASSES = "columns-1 md:columns-2 lg:columns-3";

/** `sizes` hint matching the responsive column layout. */
export const MASONRY_RESPONSIVE_SIZES = "(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw";

export function MasonryGrid({ children, columns, gap = 12, className = "" }: MasonryGridProps) {
  const responsive = columns === undefined;
  return (
    <div
      data-testid="masonry-grid"
      className={`${responsive ? RESPONSIVE_COLUMN_CLASSES : ""} ${className}`.trim()}
      style={{ ...(responsive ? {} : { columnCount: columns }), columnGap: `${gap}px` }}
    >
      {Children.map(children, (child, index) => (
        <div
          key={isValidElement(child) && child.key !== null ? child.key : index}
          style={{ breakInside: "avoid", marginBottom: `${gap}px` }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
