"use client";

import React, { useCallback, useState } from "react";
import { useWalletContext } from "@/components/WalletProvider";
import { useNotificationsContext } from "@/contexts/NotificationsContext";
import Link from "next/link";

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
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export function NotificationDrawer() {
  const {
    notifications,
    markAllRead,
    incrementUnread,
    resetUnread,
  } = useNotificationsContext();

  const [isOpen, setIsOpen] = useState(false);

  const groupedNotifications = useCallback(() => {
    const groups: Record<string, typeof notifications> = {
      tips: [] as typeof notifications,
      follows: [] as typeof notifications,
      likes: [] as typeof notifications,
      mentions: [] as typeof notifications,
      governance: [] as typeof notifications,
    };

    notifications.forEach((n) => {
      const type = n.type as keyof typeof groups;
      if (groups[type] !== undefined) {
        groups[type].push(n);
      } else {
        groups.likes.push(n);
      }
    });

    return groups;
  }, [notifications]);

  const handleMarkAllRead = useCallback(() => {
    markAllRead();
    resetUnread();
    setIsOpen(false);
  }, [markAllRead, resetUnread]);

  return (
    <div>
      <button onClick={() => setIsOpen(true)} className="px-4 py-2 text-sm font-medium text-violet-400 hover:text-white transition-colors">
        Notifications
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Notifications drawer"
          className="mt-4 max-w-lg bg-zinc-900 rounded-xl border border-zinc-800 p-6 shadow-2xl"
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold">Notifications</h2>
            <button
              onClick={() => handleMarkAllRead()}
              className="text-violet-400 hover:text-white transition-colors text-sm font-medium"
            >
              Mark all as read
            </button>
          </div>

          <div className="space-y-4">
            {Object.entries(groupedNotifications()).map(
              (entry: [string, typeof notifications]) => {
                const [type, items] = entry;

                if (items.length === 0) return null;

                const typeLabels: Record<string, string> = {
                  tips: "Tips",
                  follows: "Follows",
                  likes: "Likes",
                  mentions: "Mentions",
                  governance: "Governance",
                };

                return (
                  <div
                    key={type}
                    className="border-b border-zinc-800/40 pb-4"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-violet-300">
                        {typeLabels[type]}
                      </span>
                      <span className="text-zinc-500 text-xs">
                        {items.length} new
                      </span>
                    </div>

                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                      {items.map((n) => {
                        const isUnread = !n.read;

                        return (
                          <div
                            key={n.id}
                            className={`flex items-start gap-3 py-2 cursor-pointer hover:bg-zinc-800/30 rounded ${isUnread ? "bg-violet-950/20" : ""}`}
                          >
                            <div
                              className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs"
                            >
                              {n.type === "tip" && <span title="Tip">💰</span>}
                              {n.type === "like" && <span title="Like">❤️</span>}
                              {n.type === "follow" && <span title="Follow">👤</span>}
                              {n.type === "mention" && <span title="Mention">💬</span>}
                              {n.type === "governance" && <span title="Governance">🏛️</span>}
                            </div>

                            <div className="flex-1 min-w-0 text-zinc-200">
                              <p className="font-semibold text-white truncate">
                                {n.actor}
                              </p>
                              {n.excerpt && (
                                <p className="text-zinc-400 italic text-xs line-clamp-1">
                                  "{n.excerpt}"
                                </p>
                              )}

                              <span className="text-[10px] text-zinc-500">
                                {formatRelativeTime(n.timestamp)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </div>
      )}
    </div>
  );
}