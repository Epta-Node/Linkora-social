import React, { useEffect, useMemo, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Linking,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { ThemeTokens } from "../theme/tokens";

export type TxToastKind = "pending" | "success" | "error";

export interface TxToastState {
  id: number;
  kind: TxToastKind;
  title: string;
  message?: string;
  txHash?: string;
}

interface TxToastProps {
  toast: TxToastState;
  onDismiss: () => void;
  theme: ThemeTokens;
}

function shortHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export function TxToast({ toast, onDismiss, theme }: TxToastProps) {
  const translateY = useRef(new Animated.Value(-24)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const explorerUrl = useMemo(() => {
    if (!toast.txHash) return null;
    return `https://stellar.expert/explorer/public/tx/${encodeURIComponent(toast.txHash)}`;
  }, [toast.txHash]);

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 15,
        mass: 0.8,
        stiffness: 180,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dy) > 8 || Math.abs(gestureState.dx) > 8,
        onPanResponderMove: (_, gestureState) => {
          translateY.setValue(Math.max(-24, gestureState.dy));
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > 60 || Math.abs(gestureState.dx) > 60) {
            onDismiss();
            return;
          }

          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            damping: 15,
            mass: 0.8,
            stiffness: 180,
          }).start();
        },
      }),
    [onDismiss, translateY]
  );

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          backgroundColor: theme.colors.surface.surface1,
          borderColor: theme.colors.surface.border,
          transform: [{ translateY }],
          opacity,
        },
      ]}
      {...panResponder.panHandlers}
    >
      <View
        style={[
          styles.accent,
          {
            backgroundColor:
              toast.kind === "success"
                ? theme.colors.semantic.success
                : toast.kind === "error"
                  ? theme.colors.semantic.error
                  : theme.colors.brand.secondary,
          },
        ]}
      />
      <View style={styles.body}>
        <View style={styles.row}>
          <Text style={[styles.title, { color: theme.colors.text.primary }]}>{toast.title}</Text>
          {toast.kind === "pending" ? (
            <ActivityIndicator color={theme.colors.brand.primary} size="small" />
          ) : null}
        </View>
        {toast.message ? (
          <Text style={[styles.message, { color: theme.colors.text.secondary }]}>
            {toast.message}
          </Text>
        ) : null}
        {toast.kind === "success" && explorerUrl ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Open Stellar Expert transaction"
            onPress={() => Linking.openURL(explorerUrl).catch(() => undefined)}
            style={styles.linkWrap}
          >
            <Text style={[styles.link, { color: theme.colors.brand.secondary }]}>
              {shortHash(toast.txHash ?? "")}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss toast" onPress={onDismiss}>
        <Text style={[styles.dismiss, { color: theme.colors.text.secondary }]}>Dismiss</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    shadowColor: "rgba(0, 0, 0, 1)",
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  accent: {
    width: 5,
    alignSelf: "stretch",
    borderRadius: 9999,
  },
  body: {
    flex: 1,
    gap: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
  },
  message: {
    fontSize: 13,
    lineHeight: 18,
  },
  linkWrap: {
    alignSelf: "flex-start",
  },
  link: {
    fontSize: 12,
    fontWeight: "700",
  },
  dismiss: {
    fontSize: 12,
    fontWeight: "600",
  },
});
