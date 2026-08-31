import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, Alert, StyleSheet } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useWalletContext } from "../../context/WalletContext";
import { useToast } from "../../context/ToastContext";
import { useNetwork } from "../../hooks/useNetwork";
import { DmService } from "../../utils/mockDm";
import { EmptyState, ErrorState } from "../../components/states";
import { DmMessage, getDmMessages, initDatabase, setDmLastRead } from "../../utils/db";
import { reconcileDmThread, sendDmMessageWithOutbox } from "../../utils/sync";

/**
 * Local partition key for this device's DM cache. Purely local (never sent
 * to the relay), so it only needs to be stable and symmetric per pair.
 */
function conversationKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

export default function DirectMessageScreen() {
  const router = useRouter();
  const { address } = useLocalSearchParams<{ address: string }>();
  const { wallet } = useWalletContext();
  const { showToast } = useToast();
  const { isOffline } = useNetwork();

  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dmService, setDmService] = useState<DmService | null>(null);

  const [isTyping, setIsTyping] = useState(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastTypingSentRef = useRef<number>(0);
  const wasOfflineRef = useRef(isOffline);

  const conversationId = useMemo(
    () => (wallet?.address && address ? conversationKey(wallet.address, address) : null),
    [wallet?.address, address]
  );

  /**
   * Advances the read watermark from the freshly loaded, post-reconciliation
   * state only — never from a stale snapshot — so messages that arrived on
   * another device while this one was offline can't be skipped as "already
   * read" before they've actually been merged in.
   */
  const advanceLastRead = useCallback(
    async (msgs: DmMessage[]) => {
      if (!conversationId) return;
      const syncedTimestamps = msgs
        .filter((m) => m.syncStatus === "synced")
        .map((m) => m.timestamp);
      if (syncedTimestamps.length === 0) return;
      await setDmLastRead(conversationId, Math.max(...syncedTimestamps));
    },
    [conversationId]
  );

  const loadLocalMessages = useCallback(async () => {
    if (!conversationId) return;
    const msgs = await getDmMessages(conversationId);
    setMessages(msgs);
    return msgs;
  }, [conversationId]);

  /**
   * Reconciles deltas from the relay/mock into the local cache, then reloads
   * from local storage so the thread reflects the merged state — including
   * messages sent from another device while this one was offline.
   */
  const syncAndLoad = useCallback(
    async (service: DmService) => {
      if (!address || !conversationId) return;
      try {
        await reconcileDmThread(service, conversationId, address);
      } catch (err) {
        // Reconciliation failures shouldn't block showing what's already local.
        console.error(`Failed to reconcile DM thread ${conversationId}:`, err);
      }
      const msgs = await loadLocalMessages();
      if (msgs) await advanceLastRead(msgs);
    },
    [address, conversationId, loadLocalMessages, advanceLastRead]
  );

  const loadMessages = useCallback(async () => {
    if (!dmService) return;
    await syncAndLoad(dmService);
  }, [dmService, syncAndLoad]);

  // Clean up typing timeout
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  // Reconcile with the relay on reconnect, so messages sent from another
  // device while this one was offline show up without a manual refresh.
  useEffect(() => {
    const wasOffline = wasOfflineRef.current;
    wasOfflineRef.current = isOffline;
    if (wasOffline && !isOffline && dmService) {
      syncAndLoad(dmService);
    }
  }, [isOffline, dmService, syncAndLoad]);

  // Initialize DM service and check if keys need to be generated
  useEffect(() => {
    if (!wallet || !address) return;

    const initializeDm = async () => {
      try {
        setLoading(true);
        await initDatabase();
        const service = new DmService(wallet, "https://dm-relay.linkora.app");

        // Check if user has DM keys, if not prompt to generate
        const hasKeys = await service.hasLocalKeys();
        if (!hasKeys) {
          Alert.alert(
            "Enable Direct Messages",
            "To send encrypted messages, you need to generate encryption keys. This only needs to be done once.",
            [
              {
                text: "Cancel",
                style: "cancel",
                onPress: () => router.back(),
              },
              {
                text: "Generate Keys",
                onPress: async () => {
                  try {
                    await service.generateAndPublishKeys();
                    showToast({ kind: "success", title: "Encryption keys generated successfully" });
                    setDmService(service);
                    service.connectRealTime();
                    service.onRealTimeEvent((payload: Record<string, unknown>) => {
                      if (payload.type === "new_message" && payload.sender === address) {
                        syncAndLoad(service);
                      } else if (payload.type === "typing_status" && payload.sender === address) {
                        setIsTyping(true);
                        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                        typingTimeoutRef.current = setTimeout(() => {
                          setIsTyping(false);
                        }, 5000);
                      }
                    });
                  } catch (err) {
                    setError(`Failed to generate keys: ${err}`);
                  }
                },
              },
            ]
          );
          return;
        }

        setDmService(service);
        service.connectRealTime();
        service.onRealTimeEvent((payload: Record<string, unknown>) => {
          if (payload.type === "new_message" && payload.sender === address) {
            syncAndLoad(service);
          } else if (payload.type === "typing_status" && payload.sender === address) {
            setIsTyping(true);
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = setTimeout(() => {
              setIsTyping(false);
            }, 5000);
          }
        });
        await syncAndLoad(service);
      } catch (err) {
        setError(`Failed to initialize messaging: ${err}`);
      } finally {
        setLoading(false);
      }
    };

    initializeDm();
  }, [wallet, address, router, showToast, syncAndLoad]);

  const sendMessage = useCallback(async () => {
    if (!dmService || !newMessage.trim() || !address || !wallet?.address || !conversationId) return;

    const content = newMessage.trim();
    setNewMessage("");

    try {
      setLoading(true);
      const sent = await sendDmMessageWithOutbox(
        dmService,
        conversationId,
        wallet.address,
        address,
        content
      );
      await loadMessages();

      if (sent.syncStatus === "failed") {
        showToast({ kind: "error", title: sent.errorMessage || "Message rejected by relay" });
      } else {
        showToast({ kind: "success", title: "Message sent" });
      }
    } catch (err) {
      setError(`Failed to send message: ${err}`);
      showToast({ kind: "error", title: "Failed to send message" });
    } finally {
      setLoading(false);
    }
  }, [dmService, newMessage, address, wallet?.address, conversationId, loadMessages, showToast]);

  const handleTextChange = (text: string) => {
    setNewMessage(text);
    if (!dmService || !address) return;

    const now = Date.now();
    if (now - lastTypingSentRef.current > 3000) {
      dmService.sendTypingStatus(address);
      lastTypingSentRef.current = now;
    }
  };

  const renderMessage = ({ item }: { item: DmMessage }) => {
    const isMyMessage = item.sender === wallet?.address;

    return (
      <View style={[styles.messageContainer, isMyMessage ? styles.myMessage : styles.theirMessage]}>
        <Text
          style={[styles.messageText, isMyMessage ? styles.myMessageText : styles.theirMessageText]}
        >
          {item.content}
        </Text>
        <Text style={styles.timestamp}>{new Date(item.timestamp * 1000).toLocaleTimeString()}</Text>
        {item.syncStatus === "pending" && <Text style={styles.pendingBadge}>⏳ Sending...</Text>}
        {item.syncStatus === "failed" && (
          <Text style={styles.failedBadge}>
            ⚠️ Failed to send{item.errorMessage ? `: ${item.errorMessage}` : ""}
          </Text>
        )}
      </View>
    );
  };

  if (error) {
    return (
      <ErrorState
        message={error}
        onRetry={() => {
          setError(null);
          loadMessages();
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Direct Message</Text>
        <Text style={styles.addressText}>{address?.slice(0, 8)}...</Text>
      </View>

      {isTyping && (
        <View style={styles.typingIndicatorHeader}>
          <Text style={styles.typingTextHeader}>{address?.slice(0, 8)}... is typing...</Text>
        </View>
      )}

      <View style={styles.messagesContainer}>
        {messages.length === 0 ? (
          <EmptyState
            icon="💬"
            title="No messages yet"
            subtitle="Start a conversation by sending the first message"
          />
        ) : (
          <FlatList
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item, index) => `${item.id}-${index}`}
            showsVerticalScrollIndicator={false}
            style={styles.messagesList}
          />
        )}
      </View>

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.textInput}
          value={newMessage}
          onChangeText={handleTextChange}
          placeholder="Type a message..."
          multiline
          maxLength={500}
          editable={!loading && !!dmService}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            (!newMessage.trim() || loading || !dmService) && styles.sendButtonDisabled,
          ]}
          onPress={sendMessage}
          disabled={!newMessage.trim() || loading || !dmService}
        >
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e1e5e9",
  },
  backButton: {
    color: "#007AFF",
    fontSize: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1d2129",
  },
  addressText: {
    fontSize: 14,
    color: "#65676b",
  },
  typingIndicatorHeader: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: "#f8f9fa",
    borderBottomWidth: 1,
    borderBottomColor: "#e1e5e9",
  },
  typingTextHeader: {
    fontSize: 12,
    color: "#65676b",
    fontStyle: "italic",
  },
  messagesContainer: {
    flex: 1,
  },
  messagesList: {
    flex: 1,
    paddingHorizontal: 16,
  },
  messageContainer: {
    marginVertical: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    maxWidth: "80%",
  },
  myMessage: {
    alignSelf: "flex-end",
    backgroundColor: "#007AFF",
  },
  theirMessage: {
    alignSelf: "flex-start",
    backgroundColor: "#f0f0f0",
  },
  messageText: {
    fontSize: 16,
  },
  myMessageText: {
    color: "#fff",
  },
  theirMessageText: {
    color: "#1d2129",
  },
  timestamp: {
    fontSize: 12,
    color: "#65676b",
    marginTop: 4,
  },
  pendingBadge: {
    fontSize: 11,
    color: "#65676b",
    marginTop: 2,
  },
  failedBadge: {
    fontSize: 11,
    color: "#EF4444",
    fontWeight: "700",
    marginTop: 2,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#e1e5e9",
    backgroundColor: "#fff",
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e1e5e9",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 12,
    maxHeight: 100,
    fontSize: 16,
  },
  sendButton: {
    backgroundColor: "#007AFF",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sendButtonDisabled: {
    backgroundColor: "#cccccc",
  },
  sendButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
