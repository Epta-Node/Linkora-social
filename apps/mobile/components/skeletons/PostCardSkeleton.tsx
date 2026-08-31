import React from "react";
import { StyleSheet, View } from "react-native";

import { SkeletonBase, SkeletonCircle, SkeletonLine } from "./SkeletonBase";

export function PostCardSkeleton() {
  return (
    <SkeletonBase style={styles.card} testID="post-skeleton">
      <View style={styles.header}>
        <SkeletonCircle size={40} />
        <View style={styles.meta}>
          <SkeletonLine width={104} height={14} />
          <SkeletonLine width={72} height={10} style={styles.metaLine} />
        </View>
        <SkeletonLine width={48} height={10} />
      </View>
      <SkeletonLine width="100%" height={12} style={styles.contentLine} />
      <SkeletonLine width="82%" height={12} style={styles.contentLine} />
      <View style={styles.footer}>
        <SkeletonLine width={56} height={10} />
        <SkeletonLine width={56} height={10} />
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
    gap: 10,
  },
  meta: {
    flex: 1,
    gap: 4,
  },
  metaLine: {
    marginTop: 2,
  },
  contentLine: {
    marginTop: 14,
  },
  footer: {
    flexDirection: "row",
    gap: 16,
    marginTop: 16,
  },
});
