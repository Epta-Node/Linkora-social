"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";

type AnimatedListState = "entering" | "present" | "exiting";

interface AnimatedListItem {
  key: string;
  item: any;
  state: AnimatedListState;
}

interface AnimatedListProps {
  items: any[];
  getKey: (item: any) => string;
  renderItem: (item: any, state: AnimatedListState) => ReactNode;
  className?: string;
  durationMs?: number;
  as?: "div" | "ul" | "ol";
  role?: string;
  "aria-label"?: string;
}

export function AnimatedList({
  items,
  getKey,
  renderItem,
  className,
  durationMs = 220,
  as: Component = "div",
  role,
  "aria-label": ariaLabel,
}: AnimatedListProps) {
  const [renderedItems, setRenderedItems] = useState<AnimatedListItem[]>(() =>
    items.map((item) => ({
      key: getKey(item),
      item,
      state: "present",
    }))
  );
  const timeoutsRef = useRef<Map<string, number>>(new Map());

  const itemsByKey = useMemo(() => {
    return new Map(items.map((item) => [getKey(item), item]));
  }, [getKey, items]);

  useEffect(() => {
    setRenderedItems((current) => {
      const currentByKey = new Map(current.map((entry) => [entry.key, entry]));
      const nextEntries: AnimatedListItem[] = items.map((item) => {
        const key = getKey(item);
        const existing = currentByKey.get(key);

        if (existing) {
          return {
            key,
            item,
            state: existing.state === "exiting" ? "present" : existing.state,
          };
        }

        return {
          key,
          item,
          state: "entering",
        };
      });

      current.forEach((entry) => {
        if (!itemsByKey.has(entry.key)) {
          nextEntries.push({
            ...entry,
            state: "exiting",
          });
        }
      });

      return nextEntries;
    });
  }, [getKey, items, itemsByKey]);

  useEffect(() => {
    renderedItems.forEach((entry) => {
      const existingTimeout = timeoutsRef.current.get(entry.key);
      if (existingTimeout) {
        window.clearTimeout(existingTimeout);
        timeoutsRef.current.delete(entry.key);
      }

      if (entry.state === "entering") {
        const timeout = window.setTimeout(() => {
          setRenderedItems((current) =>
            current.map((currentEntry) =>
              currentEntry.key === entry.key && currentEntry.state === "entering"
                ? { ...currentEntry, state: "present" }
                : currentEntry
            )
          );
          timeoutsRef.current.delete(entry.key);
        }, 16);

        timeoutsRef.current.set(entry.key, timeout);
      }

      if (entry.state === "exiting") {
        const timeout = window.setTimeout(() => {
          setRenderedItems((current) =>
            current.filter((currentEntry) => currentEntry.key !== entry.key)
          );
          timeoutsRef.current.delete(entry.key);
        }, durationMs);

        timeoutsRef.current.set(entry.key, timeout);
      }
    });

    return () => {
      timeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout));
      timeoutsRef.current.clear();
    };
  }, [durationMs, renderedItems]);

  return (
    <Component className={className} role={role} aria-label={ariaLabel}>
      {renderedItems.map(({ key, item, state }) => renderItem(item, state))}
    </Component>
  );
}
