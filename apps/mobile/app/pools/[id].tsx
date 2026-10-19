import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { PoolDepositForm } from "../../components/PoolDepositForm";
import { PoolWithdrawForm } from "../../components/PoolWithdrawForm";
import { refreshPoolFromIndexer, setPoolBalance, usePoolRecord } from "../../utils/poolStore";
import { poolAdminsRoute } from "../../utils/poolCatalog";

type Tab = "deposit" | "withdraw" | "admins";

const POOL_EVENTS_URL = process.env.EXPO_PUBLIC_POOL_EVENTS_WS_URL;

export default function PoolsDetailScreen(): JSX.Element {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const poolId = Array.isArray(id) ? id[0] : (id ?? "");
  const pool = usePoolRecord(poolId);
  const [activeTab, setActiveTab] = useState<Tab>("deposit");
  const [liveState, setLiveState] = useState<"connecting" | "live" | "offline">(
    POOL_EVENTS_URL ? "connecting" : "offline"
  );

  // #1592 — this screen is reachable from the Pools tab, Explore search,
  // deep links and notification taps, so it is the one place that has to
  // reconcile pool state. It used to render `POOL_FIXTURES` under a "live"
  // badge and never called the indexer at all.
  useEffect(() => {
    if (!poolId) return;

    refreshPoolFromIndexer(poolId).catch(() => {
      // Leave the record untouched on failure. The badge below already says
      // the data is not live, and the pool store keeps its last known state.
    });
  }, [poolId]);

  useEffect(() => {
    if (!POOL_EVENTS_URL || !poolId) return;

    const socket = new WebSocket(POOL_EVENTS_URL);
    socket.onopen = () => {
      setLiveState("live");
      socket.send(JSON.stringify({ type: "subscribe_pool", poolId }));
    };
    socket.onmessage = (message) => {
      try {
        const event = JSON.parse(String(message.data)) as {
          type?: string;
          pool_id?: string;
          balance?: string;
        };
        if (event.pool_id === poolId && event.balance) {
          setPoolBalance(poolId, event.balance);
        }
      } catch {
        // Ignore malformed relay messages; the next valid event will refresh the balance.
      }
    };
    socket.onerror = () => setLiveState("offline");
    socket.onclose = () => setLiveState("offline");

    return () => socket.close();
  }, [poolId]);

  const adminPreview = useMemo(() => pool.admins.slice(0, 3), [pool.admins]);

  // #1592 — the badge must not claim "live" for fixture data. Without a relay
  // socket the only live signal available is whether the indexer has actually
  // sourced this record.
  const liveLabel = POOL_EVENTS_URL ? liveState : pool.source === "chain" ? "live" : "offline";

  if (!poolId) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.errorText}>Pool ID not found.</Text>
      </View>
    );
  }

  if (!pool) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color="#4ECDC4" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Pool</Text>
          <Text style={styles.title}>{pool.name}</Text>
          <Text style={styles.description}>{pool.description}</Text>
        </View>
        <View style={styles.liveBadge}>
          <Text style={styles.liveBadgeText}>{liveLabel}</Text>
        </View>
      </View>

      <View style={styles.summary}>
        <Metric label="Balance" value={pool.balance} />
        <Metric label="Token address" value={pool.token} mono />
        <Metric label="Admins" value={String(pool.admins.length)} />
        <Metric label="Threshold" value={`${pool.threshold} signatures`} />
      </View>

      <View style={styles.tabs} accessibilityRole="tablist">
        {(["deposit", "withdraw", "admins"] as Tab[]).map((tab) => (
          <Pressable
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab }}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      {activeTab === "deposit" ? (
        <PoolDepositForm poolId={pool.id} token={pool.token} />
      ) : activeTab === "withdraw" ? (
        <PoolWithdrawForm poolId={pool.id} />
      ) : (
        <View style={styles.adminPanel}>
          <View style={styles.adminPanelHeader}>
            <Text style={styles.panelTitle}>Admin list</Text>
            <Pressable
              onPress={() =>
                router.push(poolAdminsRoute(pool.id) as Parameters<typeof router.push>[0])
              }
              style={styles.manageButton}
              accessibilityRole="button"
              accessibilityLabel={`Manage admins for ${pool.name}`}
            >
              <Text style={styles.manageButtonText}>Manage</Text>
            </Pressable>
          </View>
          {adminPreview.map((admin) => (
            <View key={admin} style={styles.adminRow}>
              <Text style={styles.adminAddress}>
                {admin.slice(0, 10)}...{admin.slice(-6)}
              </Text>
              <Text style={styles.adminRole}>Admin</Text>
            </View>
          ))}
          {pool.admins.length > adminPreview.length ? (
            <Text style={styles.moreAdmins}>
              {pool.admins.length - adminPreview.length} more admins
            </Text>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

function Metric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, mono && styles.mono]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0D0D12",
  },
  content: {
    padding: 20,
    paddingBottom: 48,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 18,
  },
  eyebrow: {
    color: "#4ECDC4",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  title: {
    color: "#F5F5F7",
    fontSize: 28,
    fontWeight: "800",
  },
  description: {
    color: "#8E8E93",
    fontSize: 14,
    marginTop: 6,
  },
  liveBadge: {
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#2E2E3E",
    paddingHorizontal: 10,
    justifyContent: "center",
  },
  liveBadgeText: {
    color: "#C7D2FE",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  summary: {
    backgroundColor: "#1A1A23",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2E2E3E",
    marginBottom: 18,
  },
  metric: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#252530",
  },
  metricLabel: {
    color: "#8E8E93",
    fontSize: 12,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  metricValue: {
    color: "#F5F5F7",
    fontSize: 16,
    fontWeight: "700",
  },
  mono: {
    fontFamily: "monospace",
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: "#1A1A23",
    borderRadius: 8,
    padding: 4,
    marginBottom: 10,
  },
  tab: {
    flex: 1,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
  },
  tabActive: {
    backgroundColor: "#4ECDC4",
  },
  tabText: {
    color: "#8E8E93",
    fontSize: 13,
    fontWeight: "800",
  },
  tabTextActive: {
    color: "#0D0D12",
  },
  adminPanel: {
    backgroundColor: "#1A1A23",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2E2E3E",
    padding: 16,
    marginTop: 8,
  },
  adminPanelHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  panelTitle: {
    color: "#F5F5F7",
    fontSize: 18,
    fontWeight: "800",
  },
  manageButton: {
    minHeight: 36,
    justifyContent: "center",
    borderRadius: 6,
    backgroundColor: "#252530",
    paddingHorizontal: 12,
  },
  manageButtonText: {
    color: "#4ECDC4",
    fontSize: 13,
    fontWeight: "800",
  },
  adminRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#252530",
  },
  adminAddress: {
    color: "#E5E7EB",
    fontFamily: "monospace",
    fontSize: 13,
  },
  adminRole: {
    color: "#8E8E93",
    fontSize: 12,
    fontWeight: "700",
  },
  moreAdmins: {
    color: "#8E8E93",
    marginTop: 12,
    fontSize: 13,
  },
  errorText: {
    color: "#F87171",
  },
});
