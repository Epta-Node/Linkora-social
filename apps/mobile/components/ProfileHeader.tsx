import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "../theme/useTheme";

export interface ProfileData {
  address: string;
  username?: string | null;
  bio?: string | null;
}

interface Props {
  profile: ProfileData;
  /**
   * Numeric follower count. Pass `null` while the count is loading so the
   * header renders a placeholder ("—") until the network request completes.
   */
  followerCount: number | null;
  /**
   * Numeric following count. Pass `null` while the count is loading so the
   * header renders a placeholder ("—") until the network request completes.
   */
  followingCount: number | null;
  isFollowing: boolean;
  isOwnProfile?: boolean;
  onFollowersPress: () => void;
  onFollowingPress: () => void;
  onEditPress: () => void;
  onToggleFollow: () => void;
}

export default function ProfileHeader({
  profile,
  followerCount,
  followingCount,
  isFollowing,
  isOwnProfile,
  onFollowersPress,
  onFollowingPress,
  onEditPress,
  onToggleFollow,
}: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const shortAddress = `${profile.address.slice(0, 8)}…${profile.address.slice(-6)}`;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(profile.username ?? "").charAt(0).toUpperCase() || "?"}</Text>
        </View>
        <View style={styles.meta}>
          <Text style={styles.username}>{profile.username ?? shortAddress}</Text>
          <Text style={styles.address}>{shortAddress}</Text>
          {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
        </View>
        <View style={styles.actionWrap}>
          {isOwnProfile ? (
            <Pressable style={styles.editButton} onPress={onEditPress} accessibilityRole="button">
              <Text style={styles.editText}>Edit</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.followButton, isFollowing ? styles.following : null]}
              onPress={onToggleFollow}
              accessibilityRole="button"
            >
              <Text style={[styles.followText, isFollowing ? styles.followingText : null]}>
                {isFollowing ? "Following" : "Follow"}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.countsRow}>
        <Pressable onPress={onFollowersPress} accessibilityRole="button" style={styles.countItem}>
          <Text
            style={styles.countNumber}
            accessibilityLabel={followerCount === null ? "Followers loading" : `${followerCount} followers`}
            testID="follower-count"
          >
            {followerCount === null ? "—" : followerCount}
          </Text>
          <Text style={styles.countLabel}>Followers</Text>
        </Pressable>
        <Pressable onPress={onFollowingPress} accessibilityRole="button" style={styles.countItem}>
          <Text
            style={styles.countNumber}
            accessibilityLabel={followingCount === null ? "Following loading" : `${followingCount} following`}
            testID="following-count"
          >
            {followingCount === null ? "—" : followingCount}
          </Text>
          <Text style={styles.countLabel}>Following</Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.surface.border,
      backgroundColor: theme.colors.surface.background,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
    },
    avatar: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: theme.colors.brand.primary,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
    },
    avatarText: {
      color: theme.colors.text.onBrand,
      fontSize: 28,
      fontWeight: "800",
    },
    meta: {
      flex: 1,
    },
    username: {
      color: theme.colors.text.primary,
      fontSize: 18,
      fontWeight: "800",
    },
    address: {
      color: theme.colors.text.secondary,
      fontFamily: "monospace",
      marginTop: 2,
    },
    bio: {
      color: theme.colors.text.secondary,
      marginTop: 8,
    },
    actionWrap: {
      marginLeft: 8,
    },
    editButton: {
      backgroundColor: theme.colors.surface.surface1,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: theme.radius.full,
    },
    editText: {
      color: theme.colors.text.primary,
      fontWeight: "700",
    },
    followButton: {
      backgroundColor: theme.colors.brand.primary,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: theme.radius.full,
    },
    following: {
      backgroundColor: theme.colors.surface.surface1,
      borderWidth: 1,
      borderColor: theme.colors.surface.border,
    },
    followText: {
      color: theme.colors.text.onBrand,
      fontWeight: "700",
    },
    followingText: {
      color: theme.colors.text.primary,
    },
    countsRow: {
      flexDirection: "row",
      marginTop: 12,
      gap: 24,
    },
    countItem: {
      alignItems: "center",
    },
    countNumber: {
      color: theme.colors.text.primary,
      fontWeight: "800",
      fontSize: 15,
    },
    countLabel: {
      color: theme.colors.text.secondary,
      fontSize: 12,
      marginTop: 2,
    },
  });
}
