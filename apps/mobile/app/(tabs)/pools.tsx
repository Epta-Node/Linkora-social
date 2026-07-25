import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { PoolCard } from "../../components/PoolCard";
import { PoolCardSkeleton } from "../../components/skeletons/PoolCardSkeleton";
import { usePools } from "../../hooks/usePools";
import { EmptyState } from "../../components/states/EmptyState";

export default function PoolsScreen() {
  const router = useRouter();
  const { pools, loading, error, refresh } = usePools();

  const handlePoolPress = (poolId: string) => {
    router.push(`/pool/${poolId}`);
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

  if (error) {
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

      <View style={styles.listContainer}>
        {pools.map((pool) => (
          <TouchableOpacity
            key={pool.pool_id}
            onPress={() => handlePoolPress(pool.pool_id)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Pool ${pool.pool_id}`}
          >
            <PoolCard
              id={pool.pool_id}
              name={pool.token}
              description={`${pool.admins.length} admin${pool.admins.length === 1 ? "" : "s"}`}
              totalValue={`${pool.balance.toString()}`}
              participants={pool.admins.length}
              onPress={() => handlePoolPress(pool.pool_id)}
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
});
