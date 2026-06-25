import React, { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, Alert, StyleSheet } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useWalletContext } from "../../context/WalletContext";
import { useToast } from "../../context/ToastContext";
import { dm } from "linkora-sdk";
const { DmService } = dm;
import type { ConversationMessage } from "linkora-sdk";
import { EmptyState, ErrorState } from "../../components/states";

export default function DirectMessageScreen() {
  const router = useRouter();
  const { address } = useLocalSearchParams<{ address: string }>();
  const { wallet } = useWalletContext();
  const { showToast } = useToast();

  const [messages, setMessages] = useState<Array<ConversationMessage & { content: string }>>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dmService, setDmService] = useState<DmService | null>(null);

  const loadMessagesForService = useCallback(
    async (service: DmService) => {
      if (!address) return;
      try {
        const msgs = await service.getMessages(address);
        setMessages(msgs);
      } catch (err) {
        setError(`Failed to load messages: ${err}`);
      }
    },
    [address]
  );

  const loadMessages = useCallback(async () => {
    if (!dmService) return;
    await loadMessagesForService(dmService);
  }, [dmService, loadMessagesForService]);

  // Initialize DM service and check if keys need to be generated
  useEffect(() => {
    if (!wallet || !address) return;

    const initializeDm = async () => {
      try {
        setLoading(true);
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
        await loadMessagesForService(service);
      } catch (err) {
        setError(`Failed to initialize messaging: ${err}`);
      } finally {
        setLoading(false);
      }
    };

    initializeDm();
  }, [wallet, address, router, showToast, loadMessagesForService]);

  const sendMessage = useCallback(async () => {
    if (!dmService || !newMessage.trim() || !address) return;

    try {
      setLoading(true);
      await dmService.sendMessage(address, newMessage.trim());
      setNewMessage("");
      await loadMessages();
      showToast({ kind: "success", title: "Message sent" });
    } catch (err) {
      setError(`Failed to send message: ${err}`);
      showToast({ kind: "error", title: "Failed to send message" });
    } finally {
      setLoading(false);
    }
  }, [dmService, newMessage, address, loadMessages, showToast]);

  const renderMessage = ({ item }: { item: ConversationMessage & { content: string } }) => {
    const isMyMessage = item.sender === wallet?.address;

    return (
      <View style={[styles.messageContainer, isMyMessage ? styles.myMessage : styles.theirMessage]}>
        <Text
          style={[styles.messageText, isMyMessage ? styles.myMessageText : styles.theirMessageText]}
        >
          {item.content}
        </Text>
        <Text style={styles.timestamp}>{new Date(item.timestamp * 1000).toLocaleTimeString()}</Text>
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
          onChangeText={setNewMessage}
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
