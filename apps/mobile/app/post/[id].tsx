// Post detail screen — shows full content, like count, tip total, author info.
import React, { useMemo, useState, useEffect } from "react";
import { Alert, Pressable, StyleSheet, Text, View, ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";

import { useDeletePost } from "../../hooks/useDeletePost";
import { getFeedPost, retryPostFetch } from "../../hooks/useFeed";
import { useWallet } from "../../hooks/useWallet";
import { useTheme } from "../../theme/useTheme";
import { useToast } from "../../context/ToastContext";
import { Post } from "../../components/PostCard";

type PostParams = {
  id: string;
};

/**
 * Why the screen has nothing to show.
 *
 * `missing` — the indexer does not have this post (bad link, deleted post).
 * `error`   — we could not ask: offline, indexer down, malformed response.
 * Collapsing these into one "not found" is what made a transient network
 * failure look like a dead link (#1544).
 */
type LoadFailure = "missing" | "error";

export default function PostDetailScreen() {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { id } = useLocalSearchParams<PostParams>();
  const router = useRouter();
  const { address } = useWallet();
  const { deleting, deletePost } = useDeletePost();
  const { showToast } = useToast();

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    setFailure(null);
    getFeedPost(String(id))
      .then((p) => {
        if (!active) return;
        setPost(p);
        if (!p) setFailure("missing");
      })
      .catch((err) => {
        if (!active) return;
        console.error("Failed to load post details:", err);
        setFailure("error");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  const handleRetry = async () => {
    if (!id) return;
    setLoading(true);
    setFailure(null);
    try {
      const p = await retryPostFetch(String(id));
      setPost(p);
      if (!p) setFailure("missing");
    } catch (err) {
      console.error("Failed to retry post load:", err);
      setFailure("error");
    } finally {
      setLoading(false);
    }
  };

  const isAuthor = Boolean(post && address === post.author);

  // #1595 — share copies to the clipboard, which can fail (permissions,
  // unavailable module). Never let it reject silently.
  const handleShare = async () => {
    if (!post) return;
    try {
      await Clipboard.setStringAsync(`linkora://post/${post.id}`);
      showToast({ kind: "success", title: "Copied!", message: "Post link copied to clipboard." });
    } catch {
      showToast({
        kind: "error",
        title: "Couldn't copy",
        message: "Copying the post link failed. Please try again.",
      });
    }
  };

  const handleDeletePress = () => {
    if (!post) {
      return;
    }

    Alert.alert("Delete post?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const deleted = await deletePost({ postId: post.id, author: post.author });
          if (deleted) {
            router.replace("/(tabs)/feed" as Parameters<typeof router.replace>[0]);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View
        style={[
          styles.container,
          styles.content,
          { justifyContent: "center", alignItems: "center" },
        ]}
      >
        <ActivityIndicator
          size="large"
          color={theme.colors.brand.primary}
          testID="post-detail-loading"
        />
      </View>
    );
  }

  if (!post) {
    const isError = failure === "error";
    return (
      <View style={[styles.container, styles.content]}>
        <Text style={styles.label}>Post</Text>
        <Text style={styles.id}>#{id}</Text>
        <Text style={styles.placeholder} testID="post-detail-status">
          {isError
            ? "Couldn't reach the network."
            : "Post not found. It may have been deleted, or the link may be wrong."}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading post"
          onPress={() => void handleRetry()}
          style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          gestureEnabled: true,
          headerBackVisible: true,
        }}
      />
      <View style={[styles.container, styles.content]}>
        <Text style={styles.label}>Post</Text>
        <Text style={styles.id}>#{post.id}</Text>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.username}>{post.username}</Text>
            <Text style={styles.author}>{post.author}</Text>
          </View>
          <Text style={styles.contentText}>{post.content}</Text>
          <Text style={styles.stats}>
            Likes {post.like_count} | Tips {post.tip_total}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share post link"
            onPress={handleShare}
            style={({ pressed }) => [styles.shareButton, pressed && styles.shareButtonPressed]}
          >
            <Text style={styles.shareButtonText}>Share</Text>
          </Pressable>
        </View>

        {isAuthor ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete post"
            disabled={deleting}
            onPress={handleDeletePress}
            style={({ pressed }) => [
              styles.deleteButton,
              deleting && styles.deleteButtonDisabled,
              pressed && !deleting && styles.deleteButtonPressed,
            ]}
          >
            <Text style={styles.deleteButtonText}>{deleting ? "Deleting..." : "Delete post"}</Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.surface.background,
    },
    content: {
      padding: 24,
    },
    label: {
      fontSize: 12,
      color: theme.colors.text.secondary,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: 4,
    },
    id: {
      fontSize: 20,
      fontWeight: "700",
      color: theme.colors.text.primary,
      marginBottom: 16,
      fontFamily: "monospace",
    },
    placeholder: {
      fontSize: 14,
      color: theme.colors.text.secondary,
    },
    card: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.surface.border,
      backgroundColor: theme.colors.surface.surface1,
      padding: 16,
      marginBottom: 20,
    },
    header: {
      marginBottom: 12,
    },
    username: {
      color: theme.colors.text.primary,
      fontSize: 16,
      fontWeight: "700",
      marginBottom: 4,
    },
    author: {
      color: theme.colors.text.secondary,
      fontFamily: "monospace",
      fontSize: 11,
    },
    contentText: {
      color: theme.colors.text.primary,
      fontSize: 15,
      lineHeight: 22,
      marginBottom: 16,
    },
    stats: {
      color: theme.colors.text.secondary,
      fontSize: 13,
    },
    deleteButton: {
      minHeight: 46,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.semantic.error,
      paddingHorizontal: 18,
    },
    deleteButtonPressed: {
      opacity: 0.88,
    },
    deleteButtonDisabled: {
      opacity: 0.56,
    },
    deleteButtonText: {
      color: theme.colors.text.onBrand,
      fontSize: 14,
      fontWeight: "800",
    },
    shareButton: {
      minHeight: 32,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.surface.border,
      paddingHorizontal: 12,
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "flex-start",
    },
    shareButtonPressed: {
      opacity: 0.82,
    },
    shareButtonText: {
      color: theme.colors.text.secondary,
      fontSize: 12,
      fontWeight: "700",
    },
    retryButton: {
      marginTop: 20,
      minHeight: 46,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.surface.border,
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "flex-start",
      paddingHorizontal: 24,
    },
    retryButtonPressed: {
      opacity: 0.82,
    },
    retryButtonText: {
      color: theme.colors.text.primary,
      fontSize: 14,
      fontWeight: "700",
    },
  });
}
