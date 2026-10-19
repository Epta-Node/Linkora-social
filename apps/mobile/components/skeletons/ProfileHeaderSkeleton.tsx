import React from "react";
import { StyleSheet, View } from "react-native";
import { SkeletonBase, SkeletonCircle, SkeletonLine } from "./SkeletonBase";

export function ProfileHeaderSkeleton() {
  return (
    <SkeletonBase style={styles.container}>
      <View style={styles.row}>
        <SkeletonCircle size={72} />
        <View style={styles.meta}>
          <SkeletonLine width={140} height={18} />
          <SkeletonLine width={170} height={12} style={styles.line} />
          <SkeletonLine width={210} height={12} style={styles.line} />
        </View>
        <SkeletonLine width={64} height={32} />
      </View>
      <View style={styles.counts}>
        <SkeletonLine width={64} height={18} />
        <SkeletonLine width={64} height={18} />
      </View>
    </SkeletonBase>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 16, minHeight: 144 },
  row: { flexDirection: "row", alignItems: "center" },
  meta: { flex: 1, marginLeft: 12, gap: 6 },
  line: { marginTop: 2 },
  counts: { flexDirection: "row", gap: 24, marginTop: 12 },
});
