import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  isValidStellarAddress,
  normalizeAddress,
  refreshPoolFromIndexer,
  usePoolRecord,
  type PoolApproval,
} from "../../../utils/poolStore";
import { useWallet } from "../../../hooks/useWallet";
import { useSubmitTx } from "../../../hooks/useSubmitTx";

type PendingActionKind = "add" | "remove" | "threshold";

interface PendingAction {
  kind: PendingActionKind;
  value: string;
  /**
   * #1557 — wallet signatures collected for this action. An entry can only be
   * added by the connected admin signing it on-chain, so the threshold cannot
   * be met by a non-admin (or by a client that edits local state).
   */
  approvals: PoolApproval[];
}

export default function PoolAdminsScreen(): JSX.Element {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const poolId = Array.isArray(id) ? id[0] : (id ?? "");
  const pool = usePoolRecord(poolId);
  const { address, connected } = useWallet();
  const submitTx = useSubmitTx();
  const connectedAddress = address ? normalizeAddress(address) : null;
  // Fail closed: an unknown wallet is never an admin.
  const connectedIsAdmin = Boolean(
    connected && connectedAddress && pool.admins.includes(connectedAddress)
  );

  const [adminAddress, setAdminAddress] = useState("");
  const [thresholdInput, setThresholdInput] = useState("2");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // #1557 — the admin set and threshold are read from the indexer (which
  // mirrors the contract), never authored locally.
  useEffect(() => {
    refreshPoolFromIndexer(poolId).catch(() => {
      setMessage("Could not load pool admins from the indexer.");
    });
  }, [poolId, pool.source]);

  const pendingApprovals = pendingAction?.approvals ?? [];
  const canExecute = Boolean(
    pendingAction &&
    connectedIsAdmin &&
    pool.threshold >= 1 &&
    pendingApprovals.length >= pool.threshold
  );

  const queueAction = (action: PendingAction) => {
    setMessage(null);
    setPendingAction(action);
  };

  /**
   * #1591 — map a queued UI action onto the contract entrypoint that actually
   * implements it. There is no `pool_admin_change` / `pool_admin_change_approve`
   * entrypoint on the contract; the real ones are `add_pool_admin`,
   * `remove_pool_admin` and `update_pool_threshold`.
   */
  const descriptorForAction = (
    action: PendingAction,
    signers: string
  ): string => {
    const approvals = signers
      .split(",")
      .map((entry) => `${entry.trim()}=pending`)
      .join(",");

    switch (action.kind) {
      case "add":
        return `add_pool_admin:${poolId}:${action.value}:${approvals}`;
      case "remove":
        return `remove_pool_admin:${poolId}:${action.value}:${approvals}`;
      case "threshold":
        return `update_pool_threshold:${poolId}:${action.value}:${approvals}`;
    }
  };

  /**
   * #1557 — the only way to add an approval. The connected admin signs a real
   * contract invocation with their own wallet; there is no per-admin toggle to
   * click on someone else's behalf.
   */
  const signPendingAction = async () => {
    if (!connectedAddress || !connectedIsAdmin || !pendingAction) {
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const signature = await submitTx(
        descriptorForAction(pendingAction, connectedAddress)
      );

      setPendingAction((current) =>
        current
          ? {
              ...current,
              approvals: [
                ...current.approvals.filter((approval) => approval.address !== connectedAddress),
                { address: connectedAddress, signature, signedAt: Date.now() },
              ],
            }
          : current
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Approval was not signed.");
    } finally {
      setBusy(false);
    }
  };

  const executePendingAction = async () => {
    if (!pendingAction || !canExecute) {
      setMessage("Collect enough admin signatures before applying the change.");
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      // #1557 — the contract receives the action plus the threshold set of
      // signatures and is the only thing that decides whether it applies.
      await submitTx(
        descriptorForAction(
          pendingAction,
          pendingApprovals.map((approval) => approval.address).join(",")
        )
      );
      setMessage("Change submitted. The contract has the final say.");
      setPendingAction(null);
      await refreshPoolFromIndexer(poolId).catch(() => undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The contract rejected the change.");
    } finally {
      setBusy(false);
    }
  };

  const queueAddAdmin = () => {
    const value = normalizeAddress(adminAddress);

    if (!isValidStellarAddress(value)) {
      setMessage("Enter a valid Stellar address.");
      return;
    }

    queueAction({ kind: "add", value, approvals: [] });
    setAdminAddress("");
  };

  const queueRemoveAdmin = () => {
    const value = normalizeAddress(adminAddress);

    if (!isValidStellarAddress(value)) {
      setMessage("Enter a valid Stellar address.");
      return;
    }

    Alert.alert("Remove admin?", "This change will require the current threshold to sign off.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Queue removal",
        style: "destructive",
        onPress: () => queueAction({ kind: "remove", value, approvals: [] }),
      },
    ]);
  };

  const queueThresholdUpdate = () => {
    const value = thresholdInput.trim();
    const nextThreshold = Number(value);

    if (!Number.isFinite(nextThreshold) || nextThreshold < 1) {
      setMessage("Threshold must be at least 1.");
      return;
    }

    if (nextThreshold > pool.admins.length) {
      setMessage(
        `Threshold can't exceed the admin count (${pool.admins.length}). Add more admins first.`
      );
      return;
    }

    queueAction({ kind: "threshold", value, approvals: [] });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>Pool admins</Text>
      <Text style={styles.title}>{pool.name}</Text>
      <Text style={styles.subtitle}>
        Admin changes are queued, signed, and only applied after the threshold approves them.
      </Text>

      <View style={styles.panel}>
        <Text style={styles.sectionLabel}>Current admins</Text>
        {pool.admins.map((admin) => (
          <View key={admin} style={styles.adminRow}>
            <Text style={styles.adminAddress}>
              {admin.slice(0, 10)}...{admin.slice(-6)}
            </Text>
            <Text style={styles.adminTag}>
              {admin === connectedAddress ? "Connected" : "Admin"}
            </Text>
          </View>
        ))}
        <Text style={styles.meta}>Threshold: {pool.threshold} signatures required</Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionLabel}>Queue admin change</Text>
        <TextInput
          value={adminAddress}
          onChangeText={setAdminAddress}
          placeholder="G..."
          placeholderTextColor="#64748b"
          autoCapitalize="characters"
          style={styles.input}
          accessibilityLabel="Admin address"
        />
        <View style={styles.buttonRow}>
          <Pressable style={styles.secondaryButton} onPress={queueAddAdmin}>
            <Text style={styles.secondaryButtonText}>Queue add</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={queueRemoveAdmin}>
            <Text style={styles.secondaryButtonText}>Queue remove</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionLabel}>Threshold</Text>
        <TextInput
          value={thresholdInput}
          onChangeText={setThresholdInput}
          placeholder="2"
          placeholderTextColor="#64748b"
          keyboardType="number-pad"
          style={styles.input}
          accessibilityLabel="Signature threshold"
        />
        <Pressable style={styles.secondaryButton} onPress={queueThresholdUpdate}>
          <Text style={styles.secondaryButtonText}>Queue threshold update</Text>
        </Pressable>
      </View>

      <View style={styles.panel}>
        <View style={styles.rowHeader}>
          <Text style={styles.sectionLabel}>Pending action</Text>
          <Text style={styles.meta}>
            {pendingApprovals.length}/{pool.threshold} approvals
          </Text>
        </View>
        {pendingAction ? (
          <>
            <Text style={styles.pendingKind}>
              {pendingAction.kind === "add"
                ? "Add admin"
                : pendingAction.kind === "remove"
                  ? "Remove admin"
                  : "Update threshold"}
            </Text>
            <Text style={styles.pendingValue}>{pendingAction.value}</Text>

            <View style={styles.signerList}>
              {pool.admins.map((admin) => (
                <View
                  key={admin}
                  style={styles.signerRow}
                  accessibilityLabel={`Approval status for ${admin}`}
                >
                  <Text style={styles.signerAddress}>
                    {admin.slice(0, 8)}...{admin.slice(-6)}
                  </Text>
                  <Text
                    style={
                      pendingApprovals.some((approval) => approval.address === admin)
                        ? styles.approved
                        : styles.pending
                    }
                  >
                    {pendingApprovals.some((approval) => approval.address === admin)
                      ? "Signed"
                      : "Pending"}
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.buttonStack}>
              <Pressable
                style={[
                  styles.primaryButton,
                  !connectedIsAdmin || busy ? styles.buttonDisabled : null,
                ]}
                onPress={signPendingAction}
                disabled={!connectedIsAdmin || busy}
              >
                <Text style={styles.primaryButtonText}>
                  {connectedIsAdmin
                    ? busy
                      ? "Waiting for signature..."
                      : "Sign with connected admin"
                    : "Connected wallet not admin"}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.primaryButton, !canExecute || busy ? styles.buttonDisabled : null]}
                onPress={executePendingAction}
                disabled={!canExecute || busy}
              >
                <Text style={styles.primaryButtonText}>Apply change</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <Text style={styles.meta}>No pending actions.</Text>
        )}
      </View>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <Pressable
        style={styles.linkButton}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Text style={styles.linkButtonText}>Back to pool</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  content: {
    padding: 24,
    paddingBottom: 40,
  },
  eyebrow: {
    color: "#818cf8",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  title: {
    color: "#f8fafc",
    fontSize: 28,
    fontWeight: "900",
    marginBottom: 10,
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 18,
  },
  panel: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
  },
  sectionLabel: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  adminRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  adminAddress: {
    color: "#e2e8f0",
    fontSize: 13,
    fontFamily: "monospace",
  },
  adminTag: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "700",
  },
  meta: {
    color: "#94a3b8",
    fontSize: 12,
    marginTop: 12,
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
  buttonRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
  },
  secondaryButtonText: {
    color: "#e2e8f0",
    fontSize: 14,
    fontWeight: "700",
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pendingKind: {
    color: "#e0e7ff",
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 4,
  },
  pendingValue: {
    color: "#cbd5e1",
    fontSize: 12,
    fontFamily: "monospace",
    marginBottom: 12,
  },
  signerList: {
    marginBottom: 12,
  },
  signerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  signerAddress: {
    color: "#e2e8f0",
    fontSize: 12,
    fontFamily: "monospace",
  },
  approved: {
    color: "#86efac",
    fontSize: 12,
    fontWeight: "800",
  },
  pending: {
    color: "#fcd34d",
    fontSize: 12,
    fontWeight: "800",
  },
  buttonStack: {
    gap: 10,
  },
  primaryButton: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#6366f1",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  message: {
    color: "#cbd5e1",
    fontSize: 13,
    textAlign: "center",
    marginBottom: 12,
  },
  linkButton: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f172a",
  },
  linkButtonText: {
    color: "#e2e8f0",
    fontSize: 14,
    fontWeight: "700",
  },
});
