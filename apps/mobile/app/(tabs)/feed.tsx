import React, { useEffect, useRef } from "react";
import {
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  View,
  Text,
  AppState,
  ViewToken,
} from "react-native";
import { useRouter } from "expo-router";
import { PostCard, Post } from "../../components/PostCard";
import { PostCardSkeleton } from "../../components/skeletons/PostCardSkeleton";
import { EmptyState } from "../../components/states/EmptyState";
import { ErrorState } from "../../components/states/ErrorState";
import { useFeed } from "../../hooks/useFeed";
import { useTheme } from "../../theme/useTheme";
import { evictStaleCache } from "../../utils/db";
import { trackPostViewed } from "../../utils/analytics";

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
  const viewTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const viewed = useRef(new Set<string>());
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const visible = new Set(viewableItems.map((token) => String((token.item as Post).id)));
    visible.forEach((postId) => {
      if (viewed.current.has(postId) || viewTimers.current.has(postId)) return;
      viewTimers.current.set(postId, setTimeout(() => {
        viewed.current.add(postId);
        viewTimers.current.delete(postId);
        trackPostViewed({ postId, durationMs: 2000 });
      }, 2000));
    });
    viewTimers.current.forEach((timer, postId) => {
      if (!visible.has(postId)) {
        clearTimeout(timer);
        viewTimers.current.delete(postId);
      }
    });
  }).current;

  useEffect(() => () => viewTimers.current.forEach(clearTimeout), []);

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
        ) : !loading && posts.length > 0 ? <View style={styles.end}><Text style={styles.endText}>You are all caught up</Text></View> : null
      }
      onEndReached={loadMore}
      onEndReachedThreshold={0.4}
      windowSize={11}
      maxToRenderPerBatch={5}
      initialNumToRender={5}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      viewabilityConfig={{ itemVisiblePercentThreshold: 60, minimumViewTime: 250 }}
      onViewableItemsChanged={onViewableItemsChanged}
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
  end: { padding: 20, alignItems: "center" },
  endText: { color: "#94a3b8" },
});
