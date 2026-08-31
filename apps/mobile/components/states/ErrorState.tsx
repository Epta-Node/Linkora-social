import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export interface ErrorStateProps {
  message: string;
  onRetry: () => void;
  retryLabel?: string;
  title?: string;
  testID?: string;
}

export function ErrorState({
  message,
  onRetry,
  retryLabel = "Try again",
  title = "Something went wrong",
  testID = "error-state",
}: ErrorStateProps): JSX.Element {
  return (
    <View
      style={styles.container}
      testID={testID}
      accessibilityRole="alert"
      accessibilityLabel={`${title}. ${message}`}
    >
      <View style={styles.iconContainer}>
        <Text style={styles.iconText}>!</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      <Pressable
        style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={retryLabel}
        testID={`${testID}-retry`}
      >
        <Text style={styles.actionLabel}>{retryLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingVertical: 48,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: "#3f1d1d",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#7f1d1d",
  },
  iconText: {
    color: "#fecaca",
    fontSize: 30,
    fontWeight: "900",
  },
  title: {
    color: "#f8fafc",
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
  },
  message: {
    color: "#fca5a5",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginBottom: 22,
  },
  actionButton: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: "#7f1d1d",
    alignItems: "center",
    justifyContent: "center",
  },
  actionButtonPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  actionLabel: {
    color: "#fecaca",
    fontSize: 14,
    fontWeight: "700",
  },
});
