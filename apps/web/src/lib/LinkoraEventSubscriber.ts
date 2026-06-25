"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ────────────────────────────────────────────────────────────────────────── */
/*  Types                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export type EventName = "FollowEvent" | "UnfollowEvent" | "TipEvent";

export interface FollowEventData {
  follower: string;
  followee: string;
}

export interface TipEventData {
  tipper: string;
  post_id: number;
  amount: string;
  fee: string;
}

export type EventCallback<T = unknown> = (event: T) => void;

/* ────────────────────────────────────────────────────────────────────────── */
/*  Core subscriber                                                          */
/*                                                                           */
/*  Polls the indexer /api/follows/:address/followers endpoint on a timer    */
/*  and detects count changes.  In production this could be swapped for a   */
/*  WebSocket or SSE stream from the indexer.                                */
/* ────────────────────────────────────────────────────────────────────────── */

class LinkoraEventSubscriber {
  private listeners: Record<string, EventCallback<any>[]> = {};
  private abortController: AbortController | null = null;

  /* ── Pub/sub ──────────────────────────────────────────────────────── */

  on<T = unknown>(eventName: string, callback: EventCallback<T>) {
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = [];
    }
    this.listeners[eventName].push(callback as EventCallback<unknown>);
    return () => {
      this.listeners[eventName] = this.listeners[eventName].filter((cb) => cb !== callback);
    };
  }

  emit(eventName: string, data: unknown) {
    (this.listeners[eventName] ?? []).forEach((cb) => cb(data));
  }

  /* ── Polling (starts automatically when first listener attaches) ── */

  private pollIntervalMs = 10_000;
  private pollTimerId: ReturnType<typeof setInterval> | null = null;
  private watching: Map<string, { lastFollowers: number; lastTips: number }> = new Map();

  /**
   * Start watching an address for follow / tip changes.
   * Safe to call multiple times with the same address.
   */
  watch(address: string) {
    if (this.watching.has(address)) return;
    this.watching.set(address, { lastFollowers: -1, lastTips: -1 });
    this.ensurePolling();
  }

  unwatch(address: string) {
    this.watching.delete(address);
    if (this.watching.size === 0) this.stopPolling();
  }

  private ensurePolling() {
    if (this.pollTimerId) return;
    const indexerUrl =
      typeof process !== "undefined" && process.env?.NEXT_PUBLIC_INDEXER_URL
        ? process.env.NEXT_PUBLIC_INDEXER_URL
        : "http://localhost:3001";

    this.pollTimerId = setInterval(async () => {
      for (const [addr, last] of this.watching.entries()) {
        try {
          const res = await fetch(`${indexerUrl}/api/follows/${addr}/followers?limit=1`);
          if (!res.ok) continue;
          const data = await res.json();
          const total = data.total ?? 0;

          if (last.lastFollowers === -1) {
            last.lastFollowers = total;
            continue;
          }

          if (total > last.lastFollowers) {
            this.emit("FollowEvent", { followee: addr } as FollowEventData);
          } else if (total < last.lastFollowers) {
            this.emit("UnfollowEvent", { followee: addr });
          }
          last.lastFollowers = total;
        } catch {
          /* indexer unreachable — skip this tick */
        }
      }
    }, this.pollIntervalMs);
  }

  private stopPolling() {
    if (this.pollTimerId) {
      clearInterval(this.pollTimerId);
      this.pollTimerId = null;
    }
  }

  /** Convenience for Playwright / unit tests. */
  triggerMockEvent(eventName: string, data: unknown) {
    this.emit(eventName, data);
  }
}

/* Singleton — shared across the app. */
export const linkoraEventSubscriber = new LinkoraEventSubscriber();

/* Expose on window for Playwright test access. */
if (typeof window !== "undefined") {
  (window as any).__linkoraEventSubscriber = linkoraEventSubscriber;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  React hook                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Subscribe to a named event for the lifetime of the component.
 */
export function useLinkoraEvent<T = unknown>(eventName: string, callback: EventCallback<T>) {
  // Stable ref so the latest callback is always called without re-subscribing.
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    const handler: EventCallback<T> = (data) => cbRef.current(data);
    const unsubscribe = linkoraEventSubscriber.on<T>(eventName, handler);
    return unsubscribe;
  }, [eventName]);
}

/**
 * Watch an address for live follow/tip changes.
 * Cleans up on unmount or when address changes.
 */
export function useWatchAddress(address: string | undefined) {
  useEffect(() => {
    if (!address) return;
    linkoraEventSubscriber.watch(address);
    return () => linkoraEventSubscriber.unwatch(address);
  }, [address]);
}
