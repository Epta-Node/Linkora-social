import React, { useEffect } from "react";
import {
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  View,
  AppState,
} from "react-native";
import { useRouter } from "expo-router";
import { PostCard, Post } from "../../components/PostCard";
import { PostCardSkeleton } from "../../components/skeletons/PostCardSkeleton";
import { EmptyState } from "../../components/states/EmptyState";
import { ErrorState } from "../../components/states/ErrorState";
import { useFeed } from "../../hooks/useFeed";
import { useTheme } from "../../theme/useTheme";
import { evictStaleCache } from "../../utils/db";

const SKELETON_COUNT = 4;

function SkeletonList() {
  return (
    <>
      {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
        <PostCardSkeleton key={i} />
      ))}
    </>
  );
}

export default function FeedScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { posts, loading, error, loadMore, refresh } = useFeed();

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (nextAppState === "active") {
        // Sync new posts from the network.
        refresh();
        // Evict posts older than 7 days or beyond the 100-row cap (TTL eviction).
        evictStaleCache(86400 * 7, 100).catch((err) => console.warn("Cache eviction failed:", err));
      }
    });
    return () => {
      subscription.remove();
    };
  }, [refresh]);

  const isInitialLoad = loading && posts.length === 0;

  if (isInitialLoad) {
    return (
      <View style={styles.container}>
        <SkeletonList />
      </View>
    );
  }

  if (error && posts.length === 0) {
    return <ErrorState message="Could not load posts" onRetry={refresh} />;
  }

  return (
    <FlatList<Post>
      style={styles.container}
      contentContainerStyle={posts.length === 0 ? styles.emptyContainer : styles.listContent}
      data={posts}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => <PostCard post={item} />}
      ListEmptyComponent={
        <EmptyState
          icon="📭"
          title="No posts yet"
          subtitle="Be the first to post on Linkora."
          actionLabel="Explore creators"
          onAction={() => router.push("/(tabs)/explore" as Parameters<typeof router.push>[0])}
        />
      }
      ListFooterComponent={
        loading && posts.length > 0 ? (
          <ActivityIndicator
            style={styles.footer}
            color={theme.colors.brand.primary}
            size="small"
          />
        ) : null
      }
      onEndReached={loadMore}
      onEndReachedThreshold={0.4}
      refreshControl={
        <RefreshControl
          refreshing={loading && posts.length > 0}
          onRefresh={refresh}
          tintColor={theme.colors.brand.primary}
          colors={[theme.colors.brand.primary]}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  listContent: {
    paddingVertical: 8,
  },
  emptyContainer: {
    flex: 1,
  },
  center: {
    flex: 1,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  footer: {
    paddingVertical: 16,
  },
});
