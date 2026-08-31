import React, { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}

function renderIcon(icon: ReactNode): ReactNode {
  if (typeof icon === "string") {
    return <Text style={styles.iconText}>{icon}</Text>;
  }

  return icon;
}

export function EmptyState({
  icon,
  title,
  subtitle,
  actionLabel,
  onAction,
  testID = "empty-state",
}: EmptyStateProps): JSX.Element {
  return (
    <View
      style={styles.container}
      testID={testID}
      accessibilityLabel={`${title}. ${subtitle}`}
    >
      <View style={styles.iconContainer}>{renderIcon(icon)}</View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      {onAction && actionLabel ? (
        <Pressable
          style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          testID={`${testID}-action`}
        >
          <Text style={styles.actionLabel}>{actionLabel}</Text>
        </Pressable>
      ) : null}
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
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#334155",
  },
  iconText: {
    fontSize: 34,
  },
  title: {
    color: "#f8fafc",
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginBottom: 22,
  },
  actionButton: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: "#6366f1",
    alignItems: "center",
    justifyContent: "center",
  },
  actionButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  actionLabel: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
});
