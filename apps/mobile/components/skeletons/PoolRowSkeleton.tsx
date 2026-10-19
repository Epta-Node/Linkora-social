import React from "react";
import { StyleSheet, View } from "react-native";
import { SkeletonBase, SkeletonLine } from "./SkeletonBase";

export function PoolRowSkeleton() {
  return (
    <SkeletonBase style={styles.row}>
      <View style={styles.icon} />
      <View style={styles.content}>
        <View style={styles.heading}><SkeletonLine width="55%" height={15} /><SkeletonLine width={58} height={12} /></View>
        <SkeletonLine width="90%" height={12} style={styles.line} />
        <SkeletonLine width="42%" height={10} style={styles.line} />
      </View>
    </SkeletonBase>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 84, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  icon: { width: 44, height: 44, borderRadius: 10, backgroundColor: "#E5E7EB", marginRight: 12 },
  content: { flex: 1 },
  heading: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  line: { marginTop: 6 },
});
