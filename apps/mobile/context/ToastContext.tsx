import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import { TxToast, type TxToastKind } from "../components/TxToast";
import { useTheme } from "../theme/useTheme";

export type ToastKind = TxToastKind;

export interface ToastState {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  txHash?: string;
}

interface ToastContextValue {
  showToast: (toast: Omit<ToastState, "id">) => void;
  dismissToast: () => void;
  showPending: () => void;
  showSuccess: (txHash: string) => void;
  showError: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const { theme } = useTheme();
  const [toast, setToast] = useState<ToastState | null>(null);

  const dismissToast = useCallback(() => {
    setToast(null);
  }, []);

  const showToast = useCallback((nextToast: Omit<ToastState, "id">) => {
    setToast({ ...nextToast, id: Date.now() });
  }, []);

  const showPending = useCallback(() => {
    showToast({
      kind: "pending",
      title: "Transaction submitted…",
      message: "Waiting for network confirmation.",
    });
  }, [showToast]);

  const showSuccess = useCallback(
    (txHash: string) => {
      showToast({
        kind: "success",
        title: "Transaction confirmed",
        message: "View the transaction on Stellar Expert.",
        txHash,
      });
    },
    [showToast]
  );

  const showError = useCallback(
    (message: string) => {
      showToast({
        kind: "error",
        title: "Transaction failed",
        message,
      });
    },
    [showToast]
  );

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => {
      dismissToast();
    }, 4000);
    return () => clearTimeout(timer);
  }, [dismissToast, toast]);

  const value = useMemo<ToastContextValue>(
    () => ({ showToast, dismissToast, showPending, showSuccess, showError }),
    [dismissToast, showError, showPending, showSuccess, showToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <View pointerEvents="box-none" style={styles.overlay}>
          <TxToast toast={toast} onDismiss={dismissToast} theme={theme} />
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-start",
    alignItems: "stretch",
    paddingHorizontal: 16,
    paddingTop: 16,
  },
});
