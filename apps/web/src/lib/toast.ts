"use client";

/**
 * Tiny framework-free toast store.
 *
 * Optimistic mutations call `toast.error(...)` from their rollback handler.
 * Because the store lives outside React, mutations can emit an error toast
 * even when they are invoked from a hook that has no toast context (tests,
 * server-rendered boundaries), and `<Toaster />` simply subscribes to render
 * the queue.
 */

import { useSyncExternalStore } from "react";

export type ToastVariant = "error" | "success" | "info";

export interface ToastOptions {
  /** Headline shown in bold. */
  title: string;
  /** Optional supporting line, e.g. what the user can do next. */
  description?: string;
  /** Transaction hash rendered as a Stellar Expert link. */
  txHash?: string;
  /** Auto-dismiss delay in ms. Use 0 to keep the toast until dismissed. */
  duration?: number;
}

export interface Toast extends Required<Omit<ToastOptions, "description" | "txHash">> {
  id: string;
  variant: ToastVariant;
  description?: string;
  txHash?: string;
}

const DEFAULT_DURATION_MS = 6000;
const EMPTY_TOASTS: Toast[] = [];

let toasts: Toast[] = EMPTY_TOASTS;
let nextId = 0;

const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
  for (const listener of listeners) listener();
}

function scheduleDismiss(id: string, duration: number) {
  if (duration <= 0) return;
  const timer = setTimeout(() => dismiss(id), duration);
  // Node's timer object keeps the test process alive without this.
  (timer as unknown as { unref?: () => void }).unref?.();
  timers.set(id, timer);
}

function push(variant: ToastVariant, options: ToastOptions | string): string {
  const resolved: ToastOptions = typeof options === "string" ? { title: options } : options;
  const id = `toast-${++nextId}`;
  const next: Toast = {
    id,
    variant,
    title: resolved.title,
    description: resolved.description,
    txHash: resolved.txHash,
    duration: resolved.duration ?? DEFAULT_DURATION_MS,
  };

  toasts = [next, ...toasts];
  scheduleDismiss(id, next.duration);
  emit();
  return id;
}

function dismiss(id: string) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  if (!toasts.some((entry) => entry.id === id)) return;
  toasts = toasts.filter((entry) => entry.id !== id);
  emit();
}

function clear() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  if (toasts.length === 0) return;
  toasts = EMPTY_TOASTS;
  emit();
}

export const toast = {
  error: (options: ToastOptions | string) => push("error", options),
  success: (options: ToastOptions | string) => push("success", options),
  info: (options: ToastOptions | string) => push("info", options),
  dismiss,
  /** Removes every queued toast (used when the user signs out and in tests). */
  clear,
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Toast[] {
  return toasts;
}

function getServerSnapshot(): Toast[] {
  return EMPTY_TOASTS;
}

/** Subscribes a component to the toast queue. */
export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Test helper: drains the queue and cancels pending auto-dismiss timers so
 * one test cannot leak a toast into the next.
 */
export function resetToasts() {
  clear();
}
