import React, { useMemo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useTheme } from "../theme/useTheme";

export interface ProfileSearchResult {
  address: string;
  username: string;
  bio: string;
  creatorToken: string;
}

interface ProfileRowProps {
  profile: ProfileSearchResult;
  onPress: (profile: ProfileSearchResult) => void;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function ProfileRow({ profile, onPress }: ProfileRowProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => onPress(profile)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${profile.username} profile`}
      testID={`profile-result-${profile.username}`}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{profile.username.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">{profile.username}</Text>
        <Text style={styles.subtitle}>{profile.bio}</Text>
        <Text style={styles.meta}>{shortAddress(profile.address)}</Text>
      </View>
    </TouchableOpacity>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    row: {
      minHeight: 76,
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
      fontSize: 13,
      marginTop: 2,
    },
    meta: {
      color: theme.colors.text.secondary,
      fontSize: 11,
      fontFamily: "monospace",
      marginTop: 4,
    },
  });
}
