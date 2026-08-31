import React, { useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { usePoolWithdraw } from "../hooks/usePoolWithdraw";

export interface PoolWithdrawFormProps {
  poolId: string;
  onSubmitted?: () => void;
}

export function PoolWithdrawForm({ poolId, onSubmitted }: PoolWithdrawFormProps): JSX.Element {
  const {
    pool,
    recipient,
    amount,
    connectedAddress,
    signerStatuses,
    approvals,
    canSubmit,
    recipientError,
    thresholdStatus,
    toggleSigner,
    setRecipient,
    setAmount,
    submit,
    reset,
  } = usePoolWithdraw(poolId);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setMessage(null);

    try {
      const withdrawalId = await submit();

      if (!withdrawalId) {
        setMessage("Collect the required signatures before submitting.");
        return;
      }

      Alert.alert("Withdrawal queued", `Request ${withdrawalId} is ready for processing.`);
      reset();
      onSubmitted?.();
      setMessage("Withdrawal request submitted successfully.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>pool_withdraw</Text>
          <Text style={styles.title}>Withdraw from {pool.name}</Text>
        </View>
        <Text style={styles.badge}>{thresholdStatus}</Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Recipient</Text>
        <TextInput
          value={recipient}
          onChangeText={setRecipient}
          placeholder="G..."
          placeholderTextColor="#64748b"
          autoCapitalize="characters"
          style={[styles.input, recipientError ? styles.inputError : null]}
          accessibilityLabel="Recipient Stellar address"
        />
        {recipientError ? <Text style={styles.errorText}>{recipientError}</Text> : null}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Amount</Text>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          placeholder={`Amount in ${pool.token}`}
          placeholderTextColor="#64748b"
          keyboardType="decimal-pad"
          style={styles.input}
          accessibilityLabel="Withdrawal amount"
        />
      </View>

      <View style={styles.signersSection}>
        <View style={styles.signersHeader}>
          <Text style={styles.label}>Required signers</Text>
          <Text style={styles.meta}>{approvals.length} approved</Text>
        </View>

        {signerStatuses.map((signer) => (
          <Pressable
            key={signer.address}
            onPress={() => toggleSigner(signer.address)}
            style={styles.signerRow}
            accessibilityRole="button"
            accessibilityLabel={`Toggle signature for ${signer.address}`}
          >
            <Text style={styles.signerAddress}>
              {signer.address.slice(0, 8)}...{signer.address.slice(-6)}
            </Text>
            <Text style={signer.approved ? styles.approved : styles.pending}>
              {signer.approved ? "Signed" : "Pending"}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.buttonPressed,
            (!canSubmit || submitting) && styles.buttonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!canSubmit || submitting}
          accessibilityRole="button"
          accessibilityLabel="Submit withdrawal"
        >
          <Text style={styles.primaryButtonText}>
            {submitting ? "Submitting..." : "Submit withdrawal"}
          </Text>
        </Pressable>
      </View>

      {connectedAddress ? (
        <Text style={styles.connectedText}>
          Connected wallet: {connectedAddress.slice(0, 8)}...{connectedAddress.slice(-6)}
        </Text>
      ) : null}

      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#111827",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#1f2937",
    padding: 18,
    marginTop: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16,
  },
  eyebrow: {
    color: "#818cf8",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  title: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "800",
  },
  badge: {
    color: "#c4b5fd",
    backgroundColor: "#312e81",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 11,
    fontWeight: "700",
    overflow: "hidden",
  },
  field: {
    marginBottom: 14,
  },
  label: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  input: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
    color: "#f8fafc",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  inputError: {
    borderColor: "#f87171",
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 12,
    marginTop: 6,
  },
  signersSection: {
    marginTop: 8,
    marginBottom: 16,
  },
  signersHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  meta: {
    color: "#94a3b8",
    fontSize: 12,
  },
  signerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  signerAddress: {
    color: "#e2e8f0",
    fontSize: 13,
    fontFamily: "monospace",
  },
  approved: {
    color: "#86efac",
    fontSize: 12,
    fontWeight: "700",
  },
  pending: {
    color: "#fcd34d",
    fontSize: 12,
    fontWeight: "700",
  },
  actions: {
    gap: 12,
  },
  secondaryButton: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: "#6366f1",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
  buttonPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  buttonDisabled: {
    opacity: 0.48,
  },
  connectedText: {
    color: "#94a3b8",
    fontSize: 12,
    marginTop: 12,
  },
  message: {
    color: "#cbd5e1",
    fontSize: 12,
    marginTop: 10,
  },
});
