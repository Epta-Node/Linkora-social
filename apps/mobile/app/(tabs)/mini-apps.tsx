import React, { useCallback } from "react";
import { Alert, FlatList, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

import { MiniAppIcon, MiniApp } from "../../components/MiniAppIcon";
import { EmptyState } from "../../components/EmptyState";
import { useInstalledApps } from "../../mini-apps/store";

export default function MiniAppsScreen() {
  const router = useRouter();
  const { apps, uninstall } = useInstalledApps();

  const handlePress = useCallback(
    (app: MiniApp) => {
      router.push(
        `/mini-app/${app.id}?name=${encodeURIComponent(app.name)}&entry=${encodeURIComponent(app.entry)}` as Parameters<
          typeof router.push
        >[0]
      );
    },
    [router]
  );

  const handleLongPress = useCallback(
    (app: MiniApp) => {
      Alert.alert(`Uninstall ${app.name}?`, "This will remove the mini app from your launcher.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Uninstall",
          style: "destructive",
          onPress: () => uninstall(app.id),
        },
      ]);
    },
    [uninstall]
  );

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={apps.length === 0 ? styles.emptyContainer : styles.listContent}
      data={apps}
      keyExtractor={(item) => item.id}
      numColumns={3}
      columnWrapperStyle={apps.length > 0 ? styles.row : undefined}
      renderItem={({ item }) => (
        <MiniAppIcon app={item} onPress={handlePress} onLongPress={handleLongPress} />
      )}
      ListEmptyComponent={
        <EmptyState
          title="No Mini Apps"
          description="Discover and install mini apps to enhance your Linkora experience."
          actionText="Browse Discovery"
          onActionPress={() => router.push("/(tabs)/explore" as Parameters<typeof router.push>[0])}
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
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 32,
  },
  emptyContainer: {
    flex: 1,
  },
  row: {
    justifyContent: "flex-start",
  },
});
