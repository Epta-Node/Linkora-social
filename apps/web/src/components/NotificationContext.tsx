"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { TxNotification } from "./TxNotification";

export type NotificationStatus = "pending" | "success" | "error";

export interface Notification {
  id: string;
  status: NotificationStatus;
  message: string;
  txHash?: string;
}

interface NotificationContextType {
  notifications: Notification[];
  addNotification: (notification: Omit<Notification, "id">) => string;
  removeNotification: (id: string) => void;
  updateNotification: (id: string, updates: Partial<Notification>) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const addNotification = useCallback((notification: Omit<Notification, "id">) => {
    const id = Math.random().toString(36).substring(2, 9);
    setNotifications((prev) => [...prev, { ...notification, id }]);
    if (notification.status === "success") {
      setTimeout(() => removeNotification(id), 4000);
    }
    return id;
  }, [removeNotification]);

  const updateNotification = useCallback((id: string, updates: Partial<Notification>) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, ...updates } : n)));
    if (updates.status === "success") {
      setTimeout(() => removeNotification(id), 4000);
    }
  }, [removeNotification]);

  return (
    <NotificationContext.Provider value={{ notifications, addNotification, removeNotification, updateNotification }}>
      {children}
      <div
        aria-live="polite"
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          zIndex: 9999,
        }}
      >
        {notifications.map((n) => (
          <TxNotification key={n.id} notification={n} onClose={() => removeNotification(n.id)} />
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error("useNotification must be used within a NotificationProvider");
  return context;
}
