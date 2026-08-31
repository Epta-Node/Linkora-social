import React from "react";
import { StyleSheet, View } from "react-native";

import { SkeletonBase, SkeletonLine } from "./SkeletonBase";

export function PoolCardSkeleton() {
  return (
    <SkeletonBase style={styles.card}>
      <View style={styles.header}>
        <SkeletonLine width={150} height={18} />
        <SkeletonLine width={64} height={20} />
      </View>
      <SkeletonLine width="92%" height={12} style={styles.description} />
      <View style={styles.stats}>
        <View style={styles.stat}>
          <SkeletonLine width={78} height={10} />
          <SkeletonLine width={100} height={14} style={styles.statValue} />
        </View>
        <View style={styles.stat}>
          <SkeletonLine width={72} height={10} />
          <SkeletonLine width={56} height={14} style={styles.statValue} />
        </View>
      </View>
    </SkeletonBase>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 20,
    marginVertical: 8,
    marginHorizontal: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  description: {
    marginTop: 14,
  },
  stats: {
    flexDirection: "row",
    gap: 16,
    marginTop: 18,
  },
  stat: {
    flex: 1,
  },
  statValue: {
    marginTop: 6,
  },
});
