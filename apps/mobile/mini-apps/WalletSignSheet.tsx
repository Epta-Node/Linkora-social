import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { BottomSheet } from "../components/BottomSheet";
import { useTheme } from "../theme/useTheme";

export type WalletSignSheetProps = {
  xdr: string;
  onApprove: () => void;
  onReject: () => void;
  /** Defaults to `true` so existing call sites that mount the sheet on demand keep working. */
  visible?: boolean;
};

/**
 * Signature request raised by a mini app (#1790).
 *
 * Rendered in the shared gesture-driven `BottomSheet`. Every way of dismissing
 * the sheet — swipe down, backdrop tap, hardware back — counts as a rejection,
 * so a transaction is only ever signed through the explicit Approve button.
 */
export function WalletSignSheet({
  xdr,
  onApprove,
  onReject,
  visible = true,
}: WalletSignSheetProps) {
  const { theme } = useTheme();
  const colors = theme.colors;

  return (
    <BottomSheet
      visible={visible}
      onClose={onReject}
      title="Sign Transaction"
      accessibilityLabel="Sign transaction"
      testID="wallet-sign-sheet"
    >
      <Text style={[styles.description, { color: colors.text.secondary }]}>
        A mini app is requesting your signature for the following transaction:
      </Text>

      <View
        style={[styles.xdrBox, { backgroundColor: colors.surface.background }]}
        accessible
        accessibilityLabel="Transaction XDR"
      >
        <Text selectable style={[styles.xdr, { color: colors.text.primary }]}>
          {xdr}
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={onReject}
          style={[styles.button, styles.rejectButton, { borderColor: colors.surface.borderStrong }]}
          accessibilityRole="button"
          accessibilityLabel="Reject transaction"
        >
          <Text style={[styles.buttonText, { color: colors.text.primary }]}>Reject</Text>
        </Pressable>
        <Pressable
          onPress={onApprove}
          style={[styles.button, { backgroundColor: colors.brand.primary }]}
          accessibilityRole="button"
          accessibilityLabel="Approve and sign transaction"
        >
          <Text style={[styles.buttonText, styles.approveText, { color: colors.text.onBrand }]}>
            Approve
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  description: {
    fontSize: 14,
    marginBottom: 12,
  },
  xdrBox: {
    borderRadius: 8,
    padding: 12,
    maxHeight: 160,
    marginBottom: 16,
  },
  xdr: {
    fontSize: 12,
    fontFamily: "monospace",
  },
  actions: {
    flexDirection: "row",
    gap: 12,
  },
  button: {
    flex: 1,
    minHeight: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  rejectButton: {
    borderWidth: 1,
    backgroundColor: "transparent",
  },
  buttonText: {
    fontSize: 16,
  },
  approveText: {
    fontWeight: "600",
  },
});
