import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { resolvePendingRequest, rejectPendingRequest } from "../../mini-apps/bridge";
import { addOptimisticPost } from "../../utils/db";
import { useWallet } from "../../hooks/useWallet";

export default function CreatePostScreen() {
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const router = useRouter();
  const { address } = useWallet();
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed) {
      Alert.alert("Empty post", "Write something before posting.");
      return;
    }

    if (!address) {
      Alert.alert("Wallet not connected", "Connect your wallet to create posts.");
      if (requestId) {
        rejectPendingRequest(requestId, new Error("Wallet not connected"));
      }
      return;
    }

    setSubmitting(true);

    try {
      const optimisticPost = await addOptimisticPost({
        author: address,
        username: "me",
        content: trimmed,
        tip_total: 0,
      });

      if (requestId) {
        resolvePendingRequest(requestId, {
          postId: optimisticPost.id,
          content: trimmed,
          pending: true,
        });
      }

      router.back();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to create post";
      Alert.alert("Error", errorMsg);
      if (requestId) {
        rejectPendingRequest(requestId, new Error(errorMsg));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.form}>
        <Text style={styles.heading}>Create Post</Text>
        <TextInput
          style={styles.input}
          placeholder="What's on your mind?"
          placeholderTextColor="#64748b"
          value={content}
          onChangeText={setContent}
          multiline
          textAlignVertical="top"
          autoFocus
          editable={!submitting}
        />
        <TouchableOpacity
          style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.submitText}>Post</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  form: {
    flex: 1,
    padding: 16,
  },
  heading: {
    fontSize: 20,
    fontWeight: "700",
    color: "#f1f5f9",
    marginBottom: 16,
  },
  input: {
    flex: 1,
    backgroundColor: "#1e293b",
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#334155",
    minHeight: 160,
    marginBottom: 16,
  },
  submitButton: {
    backgroundColor: "#6366f1",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
});
