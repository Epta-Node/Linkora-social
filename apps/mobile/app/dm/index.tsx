import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useWalletContext } from "../../context/WalletContext";
import { useTheme } from "../../theme/useTheme";
import { getDmConversationSummaries, initDatabase, type DmConversationSummary } from "../../utils/db";
import { EmptyState } from "../../components/states";

export default function ConversationsScreen() {
  const router = useRouter();
  const { wallet } = useWalletContext();
  const { theme } = useTheme();
  const [conversations, setConversations] = useState<DmConversationSummary[]>([]);
  const load = useCallback(async () => {
    if (!wallet.address) return;
    await initDatabase();
    setConversations(await getDmConversationSummaries(wallet.address));
  }, [wallet.address]);
  useEffect(() => { void load(); }, [load]);
  if (!wallet.address) return <EmptyState icon="🔐" title="Connect a wallet" subtitle="Connect a wallet to view your conversations." />;
  return <View style={[styles.container, { backgroundColor: theme.colors.surface.background }]}>
    <FlatList data={conversations} onRefresh={load} refreshing={false} keyExtractor={(item) => item.conversationId} ListEmptyComponent={<EmptyState icon="💬" title="No conversations" subtitle="Your encrypted conversations will appear here." />} renderItem={({ item }) => <Pressable style={[styles.row, { borderBottomColor: theme.colors.surface.border }]} onPress={() => router.push(`/dm/${item.otherAddress}`)} accessibilityRole="button" accessibilityLabel={`Conversation with ${item.otherAddress}`}>
      <View style={[styles.avatar, { backgroundColor: theme.colors.brand.primary }]}><Text style={styles.avatarText}>{item.otherAddress.slice(0, 1)}</Text></View>
      <View style={styles.content}><Text style={[styles.address, { color: theme.colors.text.primary }]}>{item.otherAddress.slice(0, 8)}…{item.otherAddress.slice(-6)}</Text><Text numberOfLines={1} style={[styles.preview, { color: theme.colors.text.secondary }]}>{item.lastMessage.content}</Text></View>
      {item.unreadCount > 0 && <View style={[styles.badge, { backgroundColor: theme.colors.brand.primary }]}><Text style={styles.badgeText}>{item.unreadCount}</Text></View>}
    </Pressable>} />
  </View>;
}
const styles = StyleSheet.create({ container: { flex: 1 }, row: { minHeight: 76, flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: 1 }, avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" }, avatarText: { color: "#fff", fontSize: 18, fontWeight: "800" }, content: { flex: 1, marginLeft: 12 }, address: { fontSize: 15, fontWeight: "700" }, preview: { marginTop: 5 }, badge: { minWidth: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }, badgeText: { color: "#fff", fontWeight: "800" } });
