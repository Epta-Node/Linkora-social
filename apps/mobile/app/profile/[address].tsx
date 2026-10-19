import React, { useMemo } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useTheme } from "../../theme/useTheme";
import { useProfile } from "../../hooks/useProfile";
import { useAuthorPosts } from "../../hooks/useAuthorPosts";
import { useWallet } from "../../hooks/useWallet";
import ProfileHeader from "../../components/ProfileHeader";
import { PostCard } from "../../components/PostCard";
import { AnalyticsCard } from "../../components/AnalyticsCard";
import { EmptyState } from "../../components/states/EmptyState";
import { ErrorState } from "../../components/states/ErrorState";

type ProfileParams = {
  address: string;
};

export default function ProfileDetailScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { address } = useLocalSearchParams<ProfileParams>();
  const { address: me } = useWallet();

  const {
    profile,
    loading,
    error,
    followerCount,
    followingCount,
    isFollowing,
    toggleFollow,
    refresh,
  } = useProfile(address ?? "");

  // #1595 — query the indexer for this author's posts instead of loading the
  // whole feed and filtering it client-side.
  const {
    posts: userPosts,
    loading: postsLoading,
    error: postsError,
    refresh: refreshPosts,
    loadMore,
  } = useAuthorPosts(address);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.brand.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={refresh} style={styles.retryButton} accessibilityRole="button">
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {profile && (
        <>
          <ProfileHeader
            profile={profile}
            followerCount={followerCount}
            followingCount={followingCount}
            isFollowing={isFollowing}
            isOwnProfile={me === address}
            onFollowersPress={() =>
              router.push(
                `/profile/followers?address=${address}` as Parameters<typeof router.push>[0]
              )
            }
            onFollowingPress={() =>
              router.push(
                `/profile/following?address=${address}` as Parameters<typeof router.push>[0]
              )
            }
            onEditPress={() => router.push("/settings" as Parameters<typeof router.push>[0])}
            onToggleFollow={toggleFollow}
          />
          <AnalyticsCard creatorAddress={address ?? ""} />
        </>
      )}

      <FlatList
        data={userPosts}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <PostCard post={item} />}
        onRefresh={() => {
          refreshPosts();
          refresh();
        }}
        refreshing={postsLoading}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        contentContainerStyle={styles.list}
        // A failed author query used to render as "No posts yet", which reads as
        // "this user has not posted" rather than "we could not load them".
        ListEmptyComponent={
          postsError ? (
            <ErrorState
              message={postsError}
              onRetry={refreshPosts}
              retryLabel="Try loading posts again"
            />
          ) : (
            <EmptyState
              icon="📭"
              title="No posts yet"
              subtitle="This user hasn't posted anything."
            />
          )
        }
        // A later page that fails to load must not look like the end of the list.
        ListFooterComponent={
          postsError && userPosts.length > 0 ? (
            <View style={styles.postsErrorRow}>
              <Text style={styles.postsErrorText} accessibilityRole="alert">
                {postsError}
              </Text>
              <Pressable
                onPress={refreshPosts}
                style={styles.retryButton}
                accessibilityRole="button"
                accessibilityLabel="Try loading posts again"
              >
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : null
        }
      />
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.surface.background,
    },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.surface.background,
    },
    errorText: {
      color: theme.colors.semantic.error,
    },
    retryButton: {
      marginTop: 12,
      backgroundColor: theme.colors.brand.primary,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: theme.radius.full,
    },
    retryText: {
      color: theme.colors.text.onBrand,
      fontWeight: "700",
    },
    list: {
      paddingBottom: 48,
      backgroundColor: theme.colors.surface.background,
    },
    postsErrorRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    postsErrorText: {
      flex: 1,
      color: theme.colors.semantic.error,
      fontSize: 13,
    },
  });
}
