import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "../theme/useTheme";

export interface UserItem {
  address: string;
  username: string;
}

interface UserListItemProps {
  user: UserItem;
  onPress: (user: UserItem) => void;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function UserListItem({ user, onPress }: UserListItemProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      style={styles.row}
      onPress={() => onPress(user)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${user.username} profile`}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{user.username.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.content}>
        <Text style={styles.title}>{user.username}</Text>
        <Text style={styles.subtitle}>{shortAddress(user.address)}</Text>
      </View>
    </Pressable>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    row: {
      minHeight: 68,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.surface.border,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.colors.brand.primary,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
    },
    avatarText: {
      color: theme.colors.text.onBrand,
      fontSize: 16,
      fontWeight: "800",
    },
    content: {
      flex: 1,
    },
    title: {
      color: theme.colors.text.primary,
      fontSize: 15,
      fontWeight: "700",
    },
    subtitle: {
      color: theme.colors.text.secondary,
      fontSize: 12,
      fontFamily: "monospace",
      marginTop: 2,
    },
  });
}
