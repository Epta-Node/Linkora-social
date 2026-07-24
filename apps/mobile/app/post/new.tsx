"use client";
import React, { useMemo, useState, useCallback } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { useWallet } from "../../hooks/useWallet";
import { useTheme } from "../../theme/useTheme";
import { useToast } from "../../context/ToastContext";
import { useProfile } from "../../hooks/useProfile";
import { addOptimisticPost } from "../../utils/db";
import { syncPendingPosts } from "../../utils/sync";
import { notifyFeedUpdate } from "../../hooks/useFeed";

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_CHARS = 280;

// ── Screen ───────────────────────────────────────────────────────────────────

export default function CreatePostScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { address, connected } = useWallet();
  const { profile } = useProfile(address ?? "");
  const { showPending, showSuccess, showError, dismissToast } = useToast();

  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const remaining = MAX_CHARS - content.length;
  const overLimit = remaining < 0;
  const isEmpty = content.trim().length === 0;
  const submitDisabled = isEmpty || overLimit || submitting || !connected;

  const counterColor = useMemo(() => {
    if (overLimit) return theme.colors.semantic?.error ?? "#EF4444";
    if (remaining <= 20) return theme.colors.semantic?.warning ?? "#F59E0B";
    return theme.colors.text.secondary;
  }, [overLimit, remaining, theme]);

  const handleSubmit = useCallback(async () => {
    if (submitDisabled || !address) return;

    setSubmitting(true);
    showPending();

    try {
      const username = profile?.username || `${address.slice(0, 8)}…${address.slice(-6)}`;

      // 1. Add optimistic post to SQLite
      const localId = await addOptimisticPost(address, content.trim(), username);

      // 2. Notify the feed hook that SQLite has changed
      notifyFeedUpdate();

      dismissToast();
      showSuccess(localId);

      // 3. Navigate back to feed immediately
      router.replace("/(tabs)/feed" as Parameters<typeof router.replace>[0]);

      // 4. Submit to blockchain in background
      void syncPendingPosts().then(() => {
        notifyFeedUpdate();
      });
    } catch (err) {
      dismissToast();
      showError(err instanceof Error ? err.message : "Failed to publish post.");
      setSubmitting(false);
    }
  }, [
    submitDisabled,
    address,
    content,
    router,
    showPending,
    showSuccess,
    showError,
    dismissToast,
    profile,
  ]);

  const styles = useMemo(() => createStyles(theme), [theme]);

  // ── Not connected guard ───────────────────────────────────────────────────
  if (!connected) {
    return (
      <View style={styles.guard}>
        <Text style={styles.guardText}>Connect your wallet to create a post.</Text>
        <TouchableOpacity
          style={styles.connectBtn}
          onPress={() => router.push("/connect" as Parameters<typeof router.push>[0])}
          accessibilityRole="button"
          accessibilityLabel="Connect wallet"
        >
          <Text style={styles.connectBtnText}>Connect Wallet</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Composer */}
        <View style={styles.composerCard}>
          {/* Author hint */}
          <Text style={styles.authorHint} numberOfLines={1} accessibilityLabel="Your address">
            {`${address!.slice(0, 8)}…${address!.slice(-6)}`}
          </Text>

          {/* Text input */}
          <TextInput
            style={[styles.input, overLimit && styles.inputError]}
            value={content}
            onChangeText={setContent}
            placeholder="What's on your mind?"
            placeholderTextColor={theme.colors.text.secondary}
            multiline
            maxLength={MAX_CHARS + 20} // soft cap; hard limit via counter
            editable={!submitting}
            autoFocus
            accessibilityLabel="Post content"
            accessibilityHint={`Maximum ${MAX_CHARS} characters`}
          />

          {/* Footer: counter + submit */}
          <View style={styles.footer}>
            {/* Character counter */}
            <Text
              style={[styles.counter, { color: counterColor }]}
              accessibilityLabel={`${remaining} characters remaining`}
              accessibilityLiveRegion="polite"
            >
              {remaining}
            </Text>

            {/* Submit button */}
            <TouchableOpacity
              style={[styles.submitBtn, submitDisabled && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={submitDisabled}
              accessibilityRole="button"
              accessibilityLabel="Publish post"
              accessibilityState={{ disabled: submitDisabled, busy: submitting }}
            >
              {submitting ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Text style={styles.submitBtnText}>Post</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Over-limit error */}
          {overLimit && (
            <Text style={styles.errorMsg} accessibilityRole="alert">
              {`Post is ${Math.abs(remaining)} character${Math.abs(remaining) === 1 ? "" : "s"} over the limit.`}
            </Text>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.colors.surface.background,
    },
    scroll: {
      flex: 1,
    },
    content: {
      padding: 16,
    },
    composerCard: {
      backgroundColor: theme.colors.surface.surface1,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.surface.border,
      padding: 16,
    },
    authorHint: {
      color: theme.colors.text.secondary,
      fontSize: 12,
      fontFamily: "monospace",
      marginBottom: 10,
    },
    input: {
      color: theme.colors.text.primary,
      fontSize: 16,
      lineHeight: 24,
      minHeight: 120,
      textAlignVertical: "top",
      borderWidth: 1,
      borderColor: theme.colors.surface.border,
      borderRadius: 8,
      padding: 10,
      backgroundColor: theme.colors.surface.background,
    },
    inputError: {
      borderColor: theme.colors.semantic?.error ?? "#EF4444",
    },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 12,
    },
    counter: {
      fontSize: 14,
      fontWeight: "600",
    },
    submitBtn: {
      minHeight: 44,
      minWidth: 88,
      backgroundColor: theme.colors.brand?.primary ?? "#7C3AED",
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 20,
    },
    submitBtnDisabled: {
      opacity: 0.5,
    },
    submitBtnText: {
      color: "#ffffff",
      fontSize: 15,
      fontWeight: "700",
    },
    errorMsg: {
      color: theme.colors.semantic?.error ?? "#EF4444",
      fontSize: 12,
      marginTop: 6,
    },
    guard: {
      flex: 1,
      backgroundColor: theme.colors.surface.background,
      alignItems: "center",
      justifyContent: "center",
      padding: 32,
    },
    guardText: {
      color: theme.colors.text.secondary,
      fontSize: 15,
      textAlign: "center",
      marginBottom: 20,
    },
    connectBtn: {
      minHeight: 48,
      backgroundColor: theme.colors.brand?.primary ?? "#7C3AED",
      borderRadius: 10,
      paddingHorizontal: 24,
      alignItems: "center",
      justifyContent: "center",
    },
    connectBtnText: {
      color: "#ffffff",
      fontSize: 15,
      fontWeight: "700",
    },
  });
}
