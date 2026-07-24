import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useTip, type TipToken } from "../hooks/useTip";
import { useTheme } from "../theme/useTheme";

const SUPPORTED_TOKENS: TipToken[] = [
  {
    symbol: "XLM",
    name: "Stellar Lumens",
    address: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZXG5CHCGZXG5CHCGZXG5",
    decimals: 7,
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "GDQOE23CFSUMSVQK4Y5JHPPYK73VYCNHZHA7ENKCV37P6SUEO6XQBKPP",
    decimals: 7,
  },
];

interface TipModalProps {
  visible: boolean;
  postId: number | string;
  authorName: string;
  onClose: () => void;
}

function parseAmount(value: string): number {
  const normalized = value.trim();
  if (!normalized) {
    return 0;
  }

  return Number(normalized);
}

export function TipModal({ visible, postId, authorName, onClose }: TipModalProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [amount, setAmount] = useState("");
  const [selectedToken, setSelectedToken] = useState<TipToken>(SUPPORTED_TOKENS[0]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const { pending, status, error, result, estimateProtocolFee, tip, reset } = useTip();

  const parsedAmount = parseAmount(amount);
  const protocolFee = estimateProtocolFee(parsedAmount);
  const creatorAmount = Math.max(0, parsedAmount - protocolFee);
  const canSubmit = !pending && Number.isFinite(parsedAmount) && parsedAmount > 0;

  const handleClose = () => {
    reset();
    setAmount("");
    setValidationError(null);
    setSelectedToken(SUPPORTED_TOKENS[0]);
    onClose();
  };

  const handleSubmit = async () => {
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setValidationError("Enter a positive, non-zero amount.");
      return;
    }

    setValidationError(null);
    await tip({ postId, amount: parsedAmount, token: selectedToken });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.overlay}
      >
        <Pressable style={styles.scrim} onPress={handleClose} />
        <View style={styles.sheet} accessibilityRole="summary" accessibilityLabel="Send tip modal">
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Send Tip</Text>
              <Text style={styles.subtitle}>
                Tipping @{authorName} on post #{postId}
              </Text>
            </View>
            <Pressable accessibilityRole="button" onPress={handleClose} style={styles.closeButton}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>

          <Text style={styles.fieldLabel}>Token</Text>
          <View style={styles.tokenRow}>
            {SUPPORTED_TOKENS.map((token) => {
              const selected = token.symbol === selectedToken.symbol;
              return (
                <Pressable
                  key={token.symbol}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setSelectedToken(token)}
                  style={[styles.tokenButton, selected && styles.tokenButtonSelected]}
                >
                  <Text style={[styles.tokenSymbol, selected && styles.tokenSymbolSelected]}>
                    {token.symbol}
                  </Text>
                  <Text style={styles.tokenName}>{token.name}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.fieldLabel}>Amount</Text>
          <View style={styles.inputWrap}>
            <TextInput
              accessibilityLabel="Tip amount"
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
              editable={!pending}
              placeholder="0.00"
              placeholderTextColor={theme.colors.text.disabled}
              style={styles.input}
            />
            <Text style={styles.inputToken}>{selectedToken.symbol}</Text>
          </View>

          {validationError || error ? (
            <Text style={styles.errorText}>{validationError ?? error}</Text>
          ) : null}

          <View style={styles.feeBox}>
            <View style={styles.feeRow}>
              <Text style={styles.feeLabel}>Estimated protocol fee</Text>
              <Text style={styles.feeValue}>
                {protocolFee.toFixed(4)} {selectedToken.symbol}
              </Text>
            </View>
            <View style={styles.feeRow}>
              <Text style={styles.feeLabel}>Creator receives</Text>
              <Text style={styles.creatorValue}>
                {creatorAmount.toFixed(4)} {selectedToken.symbol}
              </Text>
            </View>
          </View>

          {status === "success" && result ? (
            <Text style={styles.successText}>
              Tip sent: {result.amount} {result.token.symbol}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Confirm tip"
            disabled={!canSubmit}
            onPress={handleSubmit}
            style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
          >
            {pending ? (
              <ActivityIndicator color={theme.colors.text.onBrand} />
            ) : (
              <Text style={styles.submitText}>Confirm Tip</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: "flex-end",
    },
    scrim: {
      ...StyleSheet.absoluteFill,
      backgroundColor: theme.colors.overlay.scrim,
    },
    sheet: {
      backgroundColor: theme.colors.surface.surface1,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      borderWidth: 1,
      borderColor: theme.colors.surface.border,
      padding: 20,
      paddingBottom: 28,
    },
    handle: {
      width: 42,
      height: 4,
      borderRadius: 999,
      alignSelf: "center",
      backgroundColor: theme.colors.surface.borderStrong,
      marginBottom: 16,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 16,
      marginBottom: 20,
    },
    title: {
      color: theme.colors.text.primary,
      fontSize: 20,
      fontWeight: "800",
    },
    subtitle: {
      color: theme.colors.text.secondary,
      fontSize: 13,
      marginTop: 4,
    },
    closeButton: {
      minHeight: 36,
      justifyContent: "center",
    },
    closeText: {
      color: theme.colors.text.secondary,
      fontSize: 13,
      fontWeight: "700",
    },
    fieldLabel: {
      color: theme.colors.text.secondary,
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 0.6,
      marginBottom: 8,
      textTransform: "uppercase",
    },
    tokenRow: {
      flexDirection: "row",
      gap: 10,
      marginBottom: 18,
    },
    tokenButton: {
      flex: 1,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.surface.border,
      backgroundColor: theme.colors.surface.background,
      padding: 12,
    },
    tokenButtonSelected: {
      borderColor: theme.colors.brand.primary,
      backgroundColor: theme.colors.brand.primaryLight,
    },
    tokenSymbol: {
      color: theme.colors.text.primary,
      fontSize: 15,
      fontWeight: "800",
    },
    tokenSymbolSelected: {
      color: theme.colors.brand.primary,
    },
    tokenName: {
      color: theme.colors.text.secondary,
      fontSize: 11,
      marginTop: 3,
    },
    inputWrap: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.surface.border,
      backgroundColor: theme.colors.surface.background,
      marginBottom: 10,
    },
    input: {
      flex: 1,
      minHeight: 48,
      paddingHorizontal: 14,
      color: theme.colors.text.primary,
      fontSize: 18,
      fontWeight: "700",
    },
    inputToken: {
      color: theme.colors.text.secondary,
      fontSize: 13,
      fontWeight: "800",
      paddingRight: 14,
    },
    errorText: {
      color: theme.colors.semantic.error,
      fontSize: 13,
      marginBottom: 10,
    },
    feeBox: {
      borderRadius: 12,
      backgroundColor: theme.colors.surface.background,
      padding: 14,
      gap: 10,
      marginBottom: 16,
    },
    feeRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 12,
    },
    feeLabel: {
      color: theme.colors.text.secondary,
      fontSize: 13,
    },
    feeValue: {
      color: theme.colors.text.primary,
      fontSize: 13,
      fontWeight: "700",
    },
    creatorValue: {
      color: theme.colors.semantic.success,
      fontSize: 13,
      fontWeight: "800",
    },
    successText: {
      color: theme.colors.semantic.success,
      fontSize: 13,
      fontWeight: "700",
      marginBottom: 12,
    },
    submitButton: {
      minHeight: 48,
      borderRadius: 12,
      backgroundColor: theme.colors.brand.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    submitButtonDisabled: {
      opacity: 0.55,
    },
    submitText: {
      color: theme.colors.text.onBrand,
      fontSize: 15,
      fontWeight: "800",
    },
  });
}

export { SUPPORTED_TOKENS };
