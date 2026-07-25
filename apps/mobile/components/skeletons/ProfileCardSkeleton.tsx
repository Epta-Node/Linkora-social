import React from "react";
import { StyleSheet, View } from "react-native";

import { SkeletonBase, SkeletonCircle, SkeletonLine } from "./SkeletonBase";

export function ProfileCardSkeleton() {
  return (
    <SkeletonBase style={styles.card}>
      <View style={styles.header}>
        <SkeletonCircle size={44} />
        <View style={styles.meta}>
          <SkeletonLine width={120} height={16} />
          <SkeletonLine width={180} height={12} style={styles.metaLine} />
          <SkeletonLine width={96} height={10} style={styles.metaLine} />
        </View>
      </View>
    </SkeletonBase>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  meta: {
    flex: 1,
  },
  metaLine: {
    marginTop: 6,
  },
});
