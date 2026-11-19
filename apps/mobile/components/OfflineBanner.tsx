import React from "react";
import { StyleSheet, Text, View } from "react-native";

export function OfflineBanner({ isOffline }: { isOffline: boolean }) {
  if (!isOffline) return null;

  return (
    <View
      testID="offline-banner"
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={styles.banner}
    >
      <Text style={styles.bannerText}>No internet connection</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "#ef4444",
    paddingTop: 48,
    paddingBottom: 8,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
  bannerText: {
    color: "#ffffff",
    fontWeight: "bold",
    fontSize: 14,
  },
});
