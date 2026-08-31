"use client";

import { Children, isValidElement, type ReactNode } from "react";

interface MasonryGridProps {
  children: ReactNode;
  columns?: number;
  gap?: number;
  className?: string;
}

export function MasonryGrid({ children, columns = 2, gap = 12, className = "" }: MasonryGridProps) {
  return (
    <div className={className} style={{ columnCount: columns, columnGap: `${gap}px` }}>
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
