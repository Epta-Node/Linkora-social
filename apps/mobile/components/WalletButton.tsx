import React, { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, ViewStyle } from "react-native";

import type { WalletProviderKind, WalletState } from "../context/WalletContext";
import { useTheme } from "../theme/useTheme";

interface WalletButtonProps {
  label: string;
  accessibilityLabel: string;
  onPress: () => Promise<void> | void;
  state?: WalletState;
  provider?: WalletProviderKind;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  style?: ViewStyle;
}

export function WalletButton({
  label,
  accessibilityLabel,
  onPress,
  state = "disconnected",
  provider,
  variant = "primary",
  disabled = false,
  style,
}: WalletButtonProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const isConnecting = state === "connecting";

  return (
    <TouchableOpacity
      style={[styles.button, styles[variant], (disabled || isConnecting) && styles.disabled, style]}
      onPress={onPress}
      disabled={disabled || isConnecting}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={provider ? `wallet-button-${provider}` : "wallet-button"}
    >
      {isConnecting ? (
        <ActivityIndicator color={theme.colors.text.onBrand} size="small" />
      ) : (
        <Text style={[styles.label, variant === "secondary" && styles.secondaryLabel]}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    button: {
      minHeight: 48,
      borderRadius: 10,
      paddingHorizontal: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    primary: {
      backgroundColor: theme.colors.brand.primary,
    },
    secondary: {
      backgroundColor: theme.colors.surface.surface1,
      borderWidth: 1,
      borderColor: theme.colors.surface.border,
    },
    danger: {
      backgroundColor: theme.colors.semantic.error,
    },
    disabled: {
      opacity: 0.6,
    },
    label: {
      color: theme.colors.text.onBrand,
      fontSize: 15,
      fontWeight: "700",
    },
    secondaryLabel: {
      color: theme.colors.text.primary,
    },
  });
}
