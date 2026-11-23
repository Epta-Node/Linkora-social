"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useNotifications } from "@/hooks/useNotifications";
import { useNotificationsContext } from "@/contexts/NotificationsContext";
import { getNotificationWSService, type TipToastEvent } from "@/services/notificationWS";
import { useWallet } from "@/hooks/useWallet";

function truncateAddress(address: string): string {
  if (!address || address.length < 10) return address || "";
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffSecs = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffSecs < 60) return "Just now";
    if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
    if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
    if (diffSecs < 604800) return `${Math.floor(diffSecs / 86400)}d ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export interface NotificationBellProps {
  tipToastThresholdXlm?: number;
}

export function NotificationBell({ tipToastThresholdXlm = 10 }: NotificationBellProps) {
  const router = useRouter();

  // Safe wallet hook access
  let address: string | null = null;
  try {
    const wallet = useWallet();
    address = wallet?.address ?? null;
  } catch {
    address = null;
  }

  // Safe notifications hook access
  let notifications: any[] = [];
  let unreadCount = 0;
  let markAllRead = async () => {};
  let markRead = (_id: string) => {};
  let markAllPending = false;

  try {
    const notifs = useNotifications();
    notifications = notifs.notifications || [];
    unreadCount = notifs.unreadCount ?? 0;
    markAllRead = notifs.markAllRead || (async () => {});
    markRead = notifs.markRead || (() => {});
    markAllPending = notifs.markAllPending ?? false;
  } catch {
    try {
      const ctx = useNotificationsContext();
      notifications = ctx.notifications || [];
      unreadCount = ctx.unreadCount ?? 0;
      markAllRead = async () => { ctx.markAllRead(); };
      markRead = (_id: string) => { ctx.decrementUnread(); };
    } catch {
      // Fallback in isolated test harness
    }
  }

  const [isOpen, setIsOpen] = useState(false);
  const [activeToast, setActiveToast] = useState<TipToastEvent | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subscribe to real-time WebSocket notifications & high-priority tip toasts
  useEffect(() => {
    const wsService = getNotificationWSService();
    wsService.setAddress(address ?? null);
    wsService.setTipThreshold(tipToastThresholdXlm);
    wsService.connect();

    const unsubscribeToast = wsService.onTipToast((toastEvent) => {
      setActiveToast(toastEvent);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = setTimeout(() => {
        setActiveToast(null);
      }, 6000);
    });

    return () => {
      unsubscribeToast();
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, [address, tipToastThresholdXlm]);

  // Click outside and escape key handling
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const toggleDropdown = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleNotificationClick = useCallback(
    (notificationId: string, postId?: string) => {
      markRead(notificationId);
      setIsOpen(false);
      if (postId) {
        router.push(`/post/${postId}`);
      } else {
        router.push("/notifications");
      }
    },
    [markRead, router]
  );

  const recentNotifications = notifications.slice(0, 6);

  return (
    <div className="relative inline-block" ref={containerRef}>
      {/* Bell Trigger Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleDropdown}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        data-testid="notifications-bell"
        className="relative rounded-lg p-1.5 text-[var(--text-muted)] hover:text-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
          />
        </svg>

        {/* Unread count badge */}
        {unreadCount > 0 && (
          <span
            role="status"
            aria-live="polite"
            data-testid="unread-badge"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white shadow-sm ring-1 ring-white/20 animate-in fade-in zoom-in"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Floating High-Priority Tip Toast */}
      {activeToast && (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="tip-toast"
          className="fixed bottom-5 right-5 z-50 flex items-start gap-3 max-w-sm rounded-xl border border-amber-500/40 bg-zinc-900/95 p-4 text-white shadow-2xl backdrop-blur-md transition-all animate-in slide-in-from-bottom-3"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="h-5 w-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
          </div>
          <div className="flex-1 text-xs">
            <p className="font-semibold text-amber-400 text-sm">Generous Tip Received! 🎉</p>
            <p className="text-zinc-300 mt-0.5">
              <span className="font-mono text-zinc-200">{truncateAddress(activeToast.tipper)}</span> tipped you{" "}
              <strong className="text-white font-bold">{activeToast.amountXlm} XLM</strong>!
            </p>
            {activeToast.excerpt && (
              <p className="text-zinc-400 italic line-clamp-1 mt-1">"{activeToast.excerpt}"</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setActiveToast(null)}
            className="text-zinc-400 hover:text-white p-1 rounded-md"
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      )}

      {/* Notifications Dropdown Panel */}
      {isOpen && (
        <div
          ref={dropdownRef}
          role="dialog"
          aria-label="Notifications panel"
          data-testid="notifications-dropdown"
          className="absolute right-0 mt-2 w-80 md:w-96 rounded-2xl border border-[var(--border-subtle,rgba(255,255,255,0.1))] bg-zinc-900 text-white shadow-2xl backdrop-blur-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 bg-zinc-900/80">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">Notifications</span>
              {unreadCount > 0 && (
                <span className="rounded-full bg-violet-600/30 px-2 py-0.5 text-[11px] font-medium text-violet-300">
                  {unreadCount} unread
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                disabled={markAllPending}
                data-testid="mark-all-read-btn"
                className="text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors disabled:opacity-50"
              >
                {markAllPending ? "Clearing..." : "Mark all as read"}
              </button>
            )}
          </div>

          {/* List of Recent Notifications */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-zinc-800/60" tabIndex={-1}>
            {recentNotifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center text-zinc-400">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="h-10 w-10 text-zinc-600 mb-2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
                  />
                </svg>
                <p className="text-sm font-medium text-zinc-300">No notifications yet</p>
                <p className="text-xs text-zinc-500 mt-1 max-w-[200px]">
                  When someone interacts with your posts, follows you, or votes, updates will appear here.
                </p>
              </div>
            ) : (
              recentNotifications.map((n) => {
                const isUnread = !n.read;
                return (
                  <div
                    key={n.id}
                    onClick={() => handleNotificationClick(n.id, n.postId)}
                    data-testid={`notification-item-${n.id}`}
                    className={`flex items-start gap-3 p-3.5 cursor-pointer transition-colors hover:bg-zinc-800/50 ${
                      isUnread ? "bg-violet-950/20" : ""
                    }`}
                  >
                    {/* Icon by notification type */}
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs">
                      {n.type === "tip" && <span title="Tip">💰</span>}
                      {n.type === "like" && <span title="Like">❤️</span>}
                      {n.type === "follow" && <span title="Follow">👤</span>}
                      {n.type === "governance" && <span title="Governance">🏛️</span>}
                    </div>

                    {/* Notification content */}
                    <div className="flex-1 min-w-0 text-xs">
                      <p className="text-zinc-200 leading-snug">
                        <span className="font-mono font-semibold text-white">
                          {truncateAddress(n.actor)}
                        </span>{" "}
                        {n.type === "tip" && (
                          <span>
                            sent you a tip of{" "}
                            <strong className="text-amber-400 font-bold">{n.amountXlm} XLM</strong>
                          </span>
                        )}
                        {n.type === "like" && <span>liked your post</span>}
                        {n.type === "follow" && <span>started following you</span>}
                        {n.type === "governance" && (
                          <span>created or updated a governance proposal</span>
                        )}
                      </p>

                      {n.excerpt && (
                        <p className="text-zinc-400 italic line-clamp-1 mt-0.5">"{n.excerpt}"</p>
                      )}

                      <span className="text-[10px] text-zinc-500 mt-1 inline-block">
                        {formatRelativeTime(n.timestamp)}
                      </span>
                    </div>

                    {/* Unread dot */}
                    {isUnread && (
                      <span
                        className="mt-1.5 h-2 w-2 rounded-full bg-violet-500 shrink-0"
                        aria-label="Unread"
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer View All Link */}
          <div className="border-t border-zinc-800 p-2.5 bg-zinc-900/90 text-center">
            <Link
              href="/notifications"
              onClick={() => setIsOpen(false)}
              className="text-xs text-zinc-400 hover:text-white transition-colors block py-1 font-medium"
            >
              View all notifications →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
