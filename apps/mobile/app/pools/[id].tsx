import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";

export default function PoolsDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pool</Text>
      <Text style={styles.id}>#{id}</Text>
      <Text style={styles.placeholder}>Pool details coming soon.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
    padding: 24,
  },
  title: {
    color: "#94a3b8",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  id: {
    color: "#f8fafc",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 12,
  },
  placeholder: {
    color: "#cbd5e1",
    fontSize: 14,
  },
});
