import React, { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { useBlock } from "../../hooks/useBlock";
import { useTheme } from "../../theme/useTheme";

function shortAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export default function BlockedUsersScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { blocked, loading, error, blocking, unblockUser, refresh } = useBlock();

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={theme.colors.brand.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable
          style={styles.retryButton}
          onPress={refresh}
          accessibilityRole="button"
          accessibilityLabel="Retry loading blocked users"
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>Safety</Text>
      <Text style={styles.title}>Blocked users</Text>
      <Text style={styles.subtitle}>
        Review accounts you have blocked and remove them if you want to see their activity again.
      </Text>

      {blocked.length > 0 ? (
        blocked.map((user) => (
          <View key={user.address} style={styles.card}>
            <View style={styles.row}>
              <View style={styles.meta}>
                <Text style={styles.address}>{shortAddress(user.address)}</Text>
                <Text style={styles.reason}>{user.reason}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Unblock ${user.address}`}
                disabled={blocking === user.address}
                onPress={() => unblockUser(user.address)}
                style={[
                  styles.unblockButton,
                  blocking === user.address && styles.unblockButtonDisabled,
                ]}
              >
                {blocking === user.address ? (
                  <ActivityIndicator size="small" color={theme.colors.semantic.error} />
                ) : (
                  <Text style={styles.unblockText}>Unblock</Text>
                )}
              </Pressable>
            </View>
          </View>
        ))
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No blocked users</Text>
          <Text style={styles.emptyText}>You have not blocked any accounts yet.</Text>
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to settings"
        onPress={() => router.back()}
        style={styles.backButton}
      >
        <Text style={styles.backText}>Back to settings</Text>
      </Pressable>
    </ScrollView>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.surface.background,
    },
    centered: {
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      gap: 12,
    },
    content: {
      padding: 24,
      gap: 16,
    },
    eyebrow: {
      color: theme.colors.brand.secondary,
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    title: {
      color: theme.colors.text.primary,
      fontSize: 28,
      fontWeight: "800",
    },
    subtitle: {
      color: theme.colors.text.secondary,
      fontSize: 14,
      lineHeight: 20,
    },
    card: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.surface.border,
      backgroundColor: theme.colors.surface.surface1,
      padding: 16,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
    },
    meta: {
      flex: 1,
      gap: 4,
    },
    address: {
      color: theme.colors.text.primary,
      fontSize: 14,
      fontWeight: "700",
      fontFamily: "monospace",
    },
    reason: {
      color: theme.colors.text.secondary,
      fontSize: 13,
    },
    unblockButton: {
      backgroundColor: theme.colors.semantic.errorLight,
      borderRadius: 9999,
      paddingHorizontal: 14,
      paddingVertical: 8,
      minWidth: 74,
      alignItems: "center",
    },
    unblockButtonDisabled: {
      opacity: 0.6,
    },
    unblockText: {
      color: theme.colors.semantic.error,
      fontSize: 12,
      fontWeight: "700",
    },
    errorText: {
      color: theme.colors.semantic.error,
      fontSize: 14,
      textAlign: "center",
    },
    retryButton: {
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.brand.primary,
      paddingHorizontal: 20,
      paddingVertical: 10,
    },
    retryText: {
      color: theme.colors.text.onBrand,
      fontSize: 14,
      fontWeight: "700",
    },
    empty: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.surface.border,
      backgroundColor: theme.colors.surface.surface1,
      padding: 20,
      alignItems: "center",
      gap: 6,
    },
    emptyTitle: {
      color: theme.colors.text.primary,
      fontSize: 16,
      fontWeight: "700",
    },
    emptyText: {
      color: theme.colors.text.secondary,
      fontSize: 13,
      textAlign: "center",
    },
    backButton: {
      marginTop: 8,
      paddingVertical: 12,
      alignItems: "center",
    },
    backText: {
      color: theme.colors.brand.primary,
      fontSize: 14,
      fontWeight: "700",
    },
  });
}
