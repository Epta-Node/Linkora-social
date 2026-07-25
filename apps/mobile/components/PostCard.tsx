import React, { useMemo } from "react";
import * as Haptics from "expo-haptics";
import {
  GestureResponderEvent,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { useLike } from "../hooks/useLike";
import { useTheme } from "../theme/useTheme";
import { PostCardSkeleton as SharedPostCardSkeleton } from "./skeletons/PostCardSkeleton";

export { SharedPostCardSkeleton as PostCardSkeleton };

export interface Post {
  id: number | string;
  author: string;
  username: string;
  content: string;
  tip_total: number;
  timestamp: number;
  like_count: number;
  has_liked?: boolean;
  sync_status?: "synced" | "pending" | "failed";
}

interface FeedPostCardProps {
  post: Post;
  onPress?: () => void;
}

interface LegacyPostCardProps {
  id: number | string;
  author: string;
  content: string;
  timestamp: string | number;
  likes?: number;
  hasLiked?: boolean;
  isLoading?: boolean;
  onPress?: () => void;
}

type PostCardProps = FeedPostCardProps | LegacyPostCardProps;

function formatTimestamp(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function normalizePost(props: PostCardProps): { post: Post; timeLabel?: string } {
  if ("post" in props) {
    return { post: props.post };
  }

  return {
    post: {
      id: props.id,
      author: props.author,
      username: props.author,
      content: props.content,
      tip_total: 0,
      timestamp: typeof props.timestamp === "number" ? props.timestamp : 0,
      like_count: props.likes ?? 0,
      has_liked: props.hasLiked ?? false,
    },
    timeLabel: typeof props.timestamp === "string" ? props.timestamp : undefined,
  };
}

export function PostCard(props: PostCardProps) {
  const { theme } = useTheme();
  const router = useRouter();
  const { post, timeLabel } = normalizePost(props);
  const onPress =
    props.onPress ?? (() => router.push(`/post/${post.id}` as Parameters<typeof router.push>[0]));
  const { liked, likeCount, pending, like } = useLike({
    postId: post.id,
    initialHasLiked: post.has_liked ?? false,
    initialLikeCount: post.like_count,
  });

  const styles = useMemo(() => createStyles(theme), [theme]);

  if ("isLoading" in props && props.isLoading) {
    return <SharedPostCardSkeleton />;
  }

  const handleLikePress = (event: GestureResponderEvent) => {
    // Stop propagation so a like tap doesn't also fire the parent card's
    // onPress (which navigates to the post detail). Guarded because some
    // react-native testing-library versions pass `undefined` here for
    // Pressable targets, and we still want haptic + like() to fire.
    if (event && typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    void like();
  };

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Post by ${post.username}`}
    >
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{post.username.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.meta}>
          <Text style={styles.username}>{post.username}</Text>
          <Text style={styles.address}>{shortAddress(post.author)}</Text>
        </View>
        <View style={styles.timeContainer}>
          <Text style={styles.time}>{timeLabel ?? formatTimestamp(post.timestamp)}</Text>
          {post.sync_status === "pending" && <Text style={styles.pendingBadge}>⏳ Syncing</Text>}
          {post.sync_status === "failed" && <Text style={styles.failedBadge}>⚠️ Failed</Text>}
        </View>
      </View>

      <Text style={styles.content}>{post.content}</Text>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            liked
              ? `Post already liked, ${likeCount} ${likeCount === 1 ? "like" : "likes"}`
              : `Like post, currently ${likeCount} ${likeCount === 1 ? "like" : "likes"}`
          }
          accessibilityState={{ disabled: liked || pending, selected: liked }}
          disabled={liked || pending}
          onPress={handleLikePress}
          style={({ pressed }) => [
            styles.likeButton,
            liked && styles.likeButtonLiked,
            pressed && !liked && !pending && styles.likeButtonPressed,
          ]}
        >
          <View style={styles.likeInner}>
            <Text style={[styles.likeIcon, liked && styles.likeIconLiked]}>
              {liked ? "♥" : "♡"}
            </Text>
            <View
              style={[styles.likeBadge, liked && styles.likeBadgeLiked]}
              testID="like-count-badge"
            >
              <Text
                style={[styles.likeBadgeText, liked && styles.likeBadgeTextLiked]}
                testID="like-count-text"
              >
                {likeCount}
              </Text>
            </View>
          </View>
        </Pressable>
        <Text style={styles.stat}>💰 {post.tip_total.toFixed(2)}</Text>
      </View>
    </TouchableOpacity>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.colors.surface.surface1,
      borderRadius: 12,
      padding: 16,
      marginHorizontal: 16,
      marginVertical: 6,
      borderWidth: 1,
      borderColor: theme.colors.surface.border,
    },
    skeleton: {
      opacity: 0.8,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 10,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.colors.brand.primary,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 10,
    },
    avatarText: {
      color: theme.colors.text.onBrand,
      fontWeight: "700",
      fontSize: 16,
    },
    meta: {
      flex: 1,
    },
    username: {
      color: theme.colors.text.primary,
      fontWeight: "600",
      fontSize: 14,
    },
    address: {
      color: theme.colors.text.secondary,
      fontSize: 11,
      fontFamily: "monospace",
    },
    time: {
      color: theme.colors.text.secondary,
      fontSize: 11,
    },
    timeContainer: {
      alignItems: "flex-end",
    },
    pendingBadge: {
      fontSize: 9,
      color: theme.colors.text.secondary,
      marginTop: 2,
    },
    failedBadge: {
      fontSize: 9,
      color: theme.colors.semantic?.error ?? "#EF4444",
      fontWeight: "700",
      marginTop: 2,
    },
    content: {
      color: theme.colors.text.primary,
      fontSize: 14,
      lineHeight: 20,
    },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 12,
      gap: 16,
    },
    likeButton: {
      minHeight: 32,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.surface.border,
      paddingHorizontal: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    likeButtonLiked: {
      borderColor: theme.colors.brand.primary,
      backgroundColor: theme.colors.brand.primaryLight,
    },
    likeButtonPressed: {
      opacity: 0.82,
    },
    likeInner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    likeIcon: {
      fontSize: 16,
      color: theme.colors.text.secondary,
      lineHeight: 18,
    },
    likeIconLiked: {
      color: theme.colors.brand.primary,
    },
    likeBadge: {
      minWidth: 22,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: theme.colors.surface.surface2,
      alignItems: "center",
      justifyContent: "center",
    },
    likeBadgeLiked: {
      backgroundColor: theme.colors.brand.primaryLight,
    },
    likeBadgeText: {
      color: theme.colors.text.secondary,
      fontSize: 11,
      fontWeight: "700",
    },
    likeBadgeTextLiked: {
      color: theme.colors.brand.primary,
    },
    stat: {
      color: theme.colors.text.secondary,
      fontSize: 12,
      fontWeight: "700",
    },
    statLiked: {
      color: theme.colors.brand.primary,
    },
    skeletonBlock: {
      backgroundColor: theme.colors.surface.surface2,
    },
    skeletonLine: {
      height: 12,
      borderRadius: 6,
      backgroundColor: theme.colors.surface.surface2,
    },
  });
}
