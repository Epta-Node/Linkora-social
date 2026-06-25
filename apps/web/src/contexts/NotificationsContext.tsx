"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

const LS_UNREAD_KEY = "linkora:notifications:unread";

interface NotificationsContextValue {
  unreadCount: number;
  incrementUnread: () => void;
  resetUnread: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue>({
  unreadCount: 0,
  incrementUnread: () => {},
  resetUnread: () => {},
});

export function useNotificationsContext(): NotificationsContextValue {
  return useContext(NotificationsContext);
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

  return (
    <NotificationsContext.Provider value={{ unreadCount, incrementUnread, resetUnread }}>
      {children}
    </NotificationsContext.Provider>
  );
}
