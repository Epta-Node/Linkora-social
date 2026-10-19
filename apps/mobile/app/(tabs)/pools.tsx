import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { PoolCard } from "../../components/PoolCard";
import { PoolCardSkeleton } from "../../components/skeletons/PoolCardSkeleton";
import { usePools } from "../../hooks/usePools";
import { EmptyState } from "../../components/states/EmptyState";
import { poolDetailRoute } from "../../utils/poolCatalog";

export default function PoolsScreen() {
  const router = useRouter();
  const { pools, loading, error, refresh } = usePools();

  // #1592 — the one pool detail route is `/pools/[id]`. This used to push
  // `/pool/[id]`, a second screen backed by ids (`pool-1/2/3`) that no pool in
  // the list had, so every card opened "Pool not found".
  const handlePoolPress = (poolId: string) => {
    router.push(poolDetailRoute(poolId) as Parameters<typeof router.push>[0]);
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Pools</Text>
          <Text style={styles.subtitle}>Community funding pools</Text>
        </View>
        <View style={styles.listContainer}>
          <PoolCardSkeleton />
          <PoolCardSkeleton />
          <PoolCardSkeleton />
        </View>
      </View>
    );
  }

  if (error && pools.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Pools</Text>
          <Text style={styles.subtitle}>Community funding pools</Text>
        </View>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={refresh}
            accessibilityRole="button"
            accessibilityLabel="Retry loading pools"
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (pools.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Pools</Text>
          <Text style={styles.subtitle}>Community funding pools</Text>
        </View>
        <EmptyState
          icon="◎"
          title="No community pools yet"
          subtitle="Pools are community treasuries managed by admins to coordinate deposits for creators and collectives."
        />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.header}>
        <Text style={styles.title}>Pools</Text>
        <Text style={styles.subtitle}>Community funding pools</Text>
      </View>

      {error ? (
        <View style={styles.noticeContainer}>
          <Text style={styles.noticeText} accessibilityRole="alert">
            {error}
          </Text>
          <TouchableOpacity
            onPress={refresh}
            accessibilityRole="button"
            accessibilityLabel="Retry loading pools"
          >
            <Text style={styles.noticeAction}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.listContainer}>
        {pools.map((pool) => (
          // #1594 — exactly one pressable per card. PoolCard is presentational
          // and no longer registers its own onPress, so a single tap fires
          // `router.push` once.
          <TouchableOpacity
            key={pool.id}
            onPress={() => handlePoolPress(pool.id)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${pool.name}, balance ${pool.balance}`}
            accessibilityHint="Opens the pool details"
          >
            <PoolCard
              id={pool.id}
              name={pool.name}
              description={pool.description}
              totalValue={pool.balance}
              participants={pool.members}
            />
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  contentContainer: {
    paddingBottom: 24,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#f1f5f9",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: "#94a3b8",
  },
  listContainer: {
    paddingHorizontal: 16,
    gap: 8,
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 14,
    marginBottom: 16,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: "#6366f1",
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  noticeContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  noticeText: {
    flex: 1,
    color: "#e2e8f0",
    fontSize: 12,
  },
  noticeAction: {
    color: "#818cf8",
    fontSize: 12,
    fontWeight: "700",
  },
});
