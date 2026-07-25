import React from "react";
import {
  Text,
  StyleSheet,
  ScrollView,
  View,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useWallet } from "../../hooks/useWallet";
import { usePool } from "../../hooks/usePool";
import { PoolDepositForm } from "../../components/PoolDepositForm";

type PoolParams = {
  id: string;
};

export default function PoolDetailScreen(): JSX.Element {
  const { id } = useLocalSearchParams<PoolParams>();
  const { wallet } = useWallet();
  const { pool, loading, error, isAdmin, refresh } = usePool(id || "");

  if (!id) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.error}>Pool ID not found</Text>
      </ScrollView>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centerContainer]}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  if (error || !pool) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.error}>{error || "Pool not found"}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={refresh}
          accessibilityRole="button"
          accessibilityLabel="Retry loading pool"
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  const isCurrentUserAdmin = wallet.address ? isAdmin(wallet.address) : false;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Pool Details</Text>
      <Text style={styles.id}>{pool.pool_id}</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Token</Text>
        <Text style={styles.sectionValue}>{pool.token}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Balance</Text>
        <Text style={styles.sectionValue}>{pool.balance.toString()}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Admins ({pool.admins.length})</Text>
        {pool.admins.map((admin, index) => (
          <View key={index} style={styles.adminItem}>
            <Text style={styles.adminAddress}>
              {admin.slice(0, 10)}...{admin.slice(-8)}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Threshold</Text>
        <Text style={styles.sectionValue}>{pool.threshold}</Text>
      </View>

      <PoolDepositForm poolId={pool.pool_id} token={pool.token} />

      {isCurrentUserAdmin && (
        <View style={styles.adminSection}>
          <Text style={styles.adminSectionTitle}>Admin Controls</Text>
          <Text style={styles.adminNote}>You are an admin of this pool</Text>
          <TouchableOpacity
            style={styles.adminButton}
            accessibilityRole="button"
            accessibilityLabel="Withdraw from pool"
            disabled={true}
          >
            <Text style={styles.adminButtonText}>Withdraw (Coming Soon)</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.adminButton}
            accessibilityRole="button"
            accessibilityLabel="Manage admins"
            disabled={true}
          >
            <Text style={styles.adminButtonText}>Manage Admins (Coming Soon)</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  centerContainer: {
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    padding: 24,
    paddingBottom: 48,
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 18,
  },
  summaryCard: {
    backgroundColor: "#111827",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#1f2937",
    padding: 16,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  summaryLabel: {
    color: "#94a3b8",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  summaryValue: {
    color: "#f8fafc",
    fontSize: 17,
    fontWeight: "800",
  },
  adminList: {
    gap: 6,
  },
  adminAddress: {
    color: "#e2e8f0",
    fontSize: 12,
    fontFamily: "monospace",
  },
  historyCard: {
    backgroundColor: "#111827",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#1f2937",
    padding: 16,
    marginTop: 16,
  },
  historyHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    gap: 12,
  },
  historyTitle: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "800",
  },
  historyButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
    alignItems: "center",
    justifyContent: "center",
  },
  historyButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#f1f5f9",
    marginBottom: 24,
    fontFamily: "monospace",
  },
  label: {
    color: "#94a3b8",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  id: {
    color: "#f8fafc",
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 24,
    fontFamily: "monospace",
  },
  section: {
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
  },
  sectionTitle: {
    fontSize: 12,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  sectionValue: {
    fontSize: 16,
    color: "#cbd5e1",
    fontWeight: "500",
  },
  adminItem: {
    paddingVertical: 8,
  },
  adminSection: {
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: "#334155",
  },
  adminSectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#f1f5f9",
    marginBottom: 8,
  },
  adminNote: {
    fontSize: 12,
    color: "#6366f1",
    marginBottom: 12,
    fontStyle: "italic",
  },
  adminButton: {
    backgroundColor: "#334155",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    opacity: 0.6,
  },
  adminButtonText: {
    color: "#cbd5e1",
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
  },
  error: {
    fontSize: 14,
    color: "#fca5a5",
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: "#6366f1",
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    alignSelf: "flex-start",
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});
