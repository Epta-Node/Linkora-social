"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

const LS_UNREAD_KEY = "linkora:notifications:unread";

interface NotificationsContextValue {
  unreadCount: number;
  incrementUnread: () => void;
  resetUnread: () => void;
  addNotification: (notification: {
    status: "pending" | "success" | "error";
    message: string;
    txHash?: string;
  }) => string;
  updateNotification: (
    id: string,
    notification: Partial<{
      status: "pending" | "success" | "error";
      message: string;
      txHash: string;
    }>
  ) => void;
}

const NotificationsContext = createContext<NotificationsContextValue>({
  unreadCount: 0,
  incrementUnread: () => {},
  resetUnread: () => {},
  addNotification: () => "",
  updateNotification: () => {},
});

export function useNotificationsContext(): NotificationsContextValue {
  return useContext(NotificationsContext);
}

export function useNotification(): NotificationsContextValue {
  return useNotificationsContext();
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const stored = localStorage.getItem(LS_UNREAD_KEY);
    if (stored) setUnreadCount(parseInt(stored, 10) || 0);
  }, []);

  const incrementUnread = useCallback(() => {
    setUnreadCount((prev) => {
      const next = prev + 1;
      localStorage.setItem(LS_UNREAD_KEY, String(next));
      return next;
    });
  }, []);

  const resetUnread = useCallback(() => {
    setUnreadCount(0);
    localStorage.removeItem(LS_UNREAD_KEY);
  }, []);

  const addNotification = useCallback(
    (notification: {
      status: "pending" | "success" | "error";
      message: string;
      txHash?: string;
    }) => {
      const id = `notification-${Date.now()}`;
      if (notification.status !== "pending") incrementUnread();
      return id;
    },
    [incrementUnread]
  );

  const updateNotification = useCallback(
    (
      _id: string,
      notification: Partial<{
        status: "pending" | "success" | "error";
        message: string;
        txHash: string;
      }>
    ) => {
      if (notification.status && notification.status !== "pending") incrementUnread();
    },
    [incrementUnread]
  );

  return (
    <NotificationsContext.Provider
      value={{ unreadCount, incrementUnread, resetUnread, addNotification, updateNotification }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}
