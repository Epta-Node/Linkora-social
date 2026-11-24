import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  RefreshControl,
  View,
  Text,
  AppState,
  ViewToken,
  StatusBar,
} from "react-native";
import { useRouter } from "expo-router";
import { PostCard, Post } from "../../components/PostCard";
import { PostCardSkeleton } from "../../components/skeletons/PostCardSkeleton";
import { EmptyState } from "../../components/states/EmptyState";
import { ErrorState } from "../../components/states/ErrorState";
import { useFeed } from "../../hooks/useFeed";
import { useTheme } from "../../theme/useTheme";
import { useNetwork } from "../../hooks/useNetwork";
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
  const network = useNetwork();
  const {
    posts,
    loading,
    refreshing,
    loadingMore,
    error,
    loadMoreError,
    hasMore,
    loadMore,
    refresh,
  } = useFeed();
  const viewTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const viewed = useRef(new Set<string>());
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const visible = new Set(viewableItems.map((token) => String((item as Post).id)));
    visible.forEach((postId) => {
      if (viewed.current.has(postId) || viewTimers.current.has(postId)) return;
      viewTimers.current.set(
        postId,
        setTimeout(() => {
          viewed.current.add(postId);
          viewTimers.current.delete(postId);
          trackPostViewed({ postId, durationMs: 2000 });
        }, 2000)
      );
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

  // onEndReached can fire repeatedly while the list settles; useFeed ignores
  // calls while a page is in flight or once the end of the feed is reached.
  const handleEndReached = useCallback(() => {
    if (!hasMore || loadingMore || refreshing || loadMoreError) return;
    loadMore();
  }, [hasMore, loadingMore, refreshing, loadMoreError, loadMore]);

  const renderFooter = useCallback(() => {
    if (posts.length === 0) return null;
    if (loadingMore) {
      return (
        <ActivityIndicator
          style={styles.footer}
          color={theme.colors.brand.primary}
          size="small"
          accessibilityLabel="Loading more posts"
          testID="feed-loading-more"
        />
      );
    }
    if (loadMoreError) {
      return (
        <View style={styles.end}>
          <Text style={styles.endText}>{loadMoreError}</Text>
          <Pressable
            onPress={loadMore}
            style={styles.retryButton}
            accessibilityRole="button"
            accessibilityLabel="Retry loading more posts"
            testID="feed-load-more-retry"
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    if (!hasMore) {
      return (
        <View style={styles.end} testID="feed-end">
          <Text style={styles.endText}>You are all caught up</Text>
        </View>
      );
    }
    return null;
  }, [posts.length, loadingMore, loadMoreError, hasMore, loadMore, theme.colors.brand.primary]);

  const isOffline = network.isOffline;
  const [isOfflineBannerVisible, setIsOfflineBannerVisible] = useState(false);

  useEffect(() => {
    setIsOfflineBannerVisible(isOffline);
  }, [isOffline]);

  const handleAppStateChange = useCallback((nextAppState: string) => {
    if (nextAppState === "active") {
      evictStaleCache(86400 * 7, 100).catch((err) =>
        console.warn("Cache eviction failed:", err)
      );
    }
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [handleAppStateChange]);

  const isInitialLoad = loading && posts.length === 0;

  if (isInitialLoad) {
    return (
      <View style={styles.container}>
        <SkeletonList />
      </View>
    );
  }

  if (isOfflineBannerVisible) {
    return (
      <View style=[styles.offlineBanner, { backgroundColor: theme.colors.surface.surface2 }]>
        <Text style={styles.offlineText}>Offline — showing cached content</Text>
        <Pressable style={styles.offlineButton} onPress={refresh}>
          <Text style={styles.offlineButtonText}>Refresh</Text>
        </Pressable>
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
      ListFooterComponent={renderFooter}
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.4}
      windowSize={11}
      maxToRenderPerBatch={5}
      initialNumToRender={5}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      viewabilityConfig={{ itemVisiblePercentThreshold: 60, minimumViewTime: 250 }}
      onViewableItemsChanged={onViewableItemsChanged}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
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
  end: { padding: 20, alignItems: "center", gap: 10 },
  endText: { color: "#94a3b8" },
  retryButton: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#334155",
    justifyContent: "center",
  },
  retryText: { color: "#e2e8f0", fontWeight: "600" },
  offlineBanner: {
    padding: 12,
    backgroundColor: "#EF4444",
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  offlineText: {
    color: "white",
    fontSize: 14,
  },
  offlineButton: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "white",
    borderRadius: 20,
  },
  offlineButtonText: {
    color: "#EF4444",
    fontSize: 12,
  },
});
