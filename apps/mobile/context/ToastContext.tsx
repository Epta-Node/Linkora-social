import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import { TxToast, type TxToastKind } from "../components/TxToast";
import { useTheme } from "../theme/useTheme";

export type ToastKind = TxToastKind;

/** Default auto-dismiss duration for informational toasts (ms). */
export const DEFAULT_DURATION_MS = 4000;
/** Default auto-dismiss duration for errors / in-flight transactions (ms). */
export const LONG_DURATION_MS = 8000;

/** Kinds that should persist longer than informational toasts by default. */
const LONG_KINDS: ReadonlySet<ToastKind> = new Set(["error", "pending"]);

export interface ToastState {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  txHash?: string;
  /** Override the auto-dismiss duration in ms. Defaults to a kind-based default. */
  durationMs?: number;
  /** When true the toast is never auto-dismissed and requires manual dismissal. */
  persistent?: boolean;
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
  const [paused, setPaused] = useState(false);

  const dismissToast = useCallback(() => {
    setToast(null);
    setPaused(false);
  }, []);

  const showToast = useCallback((nextToast: Omit<ToastState, "id">) => {
    setToast({ ...nextToast, id: Date.now() });
    setPaused(false);
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
    if (!toast || toast.persistent) return undefined;
    const durationMs =
      toast.durationMs ?? (LONG_KINDS.has(toast.kind) ? LONG_DURATION_MS : DEFAULT_DURATION_MS);
    const timer = setTimeout(() => {
      if (!paused) dismissToast();
    }, durationMs);
    return () => clearTimeout(timer);
  }, [dismissToast, paused, toast]);

  const value = useMemo<ToastContextValue>(
    () => ({ showToast, dismissToast, showPending, showSuccess, showError }),
    [dismissToast, showError, showPending, showSuccess, showToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <View pointerEvents="box-none" style={styles.overlay}>
          <TxToast toast={toast} onDismiss={dismissToast} onPauseChange={setPaused} theme={theme} />
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
