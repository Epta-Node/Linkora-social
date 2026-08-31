import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { BridgePermission } from "../mini-apps/permissions";

export interface MiniApp {
  id: string;
  name: string;
  icon: string;
  description: string;
  entry: string;
  permissions: BridgePermission[];
}

interface MiniAppIconProps {
  app: MiniApp;
  onPress: (app: MiniApp) => void;
  onLongPress?: (app: MiniApp) => void;
}

const FALLBACK_CHAR = "★";

export function MiniAppIcon({ app, onPress, onLongPress }: MiniAppIconProps) {
  const hasValidIcon = app.icon && (app.icon.startsWith("data:") || app.icon.startsWith("http"));

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => onPress(app)}
      onLongPress={() => onLongPress?.(app)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${app.name}`}
      delayLongPress={500}
    >
      <View style={styles.iconWrapper}>
        {hasValidIcon ? (
          <Image source={{ uri: app.icon }} style={styles.icon} />
        ) : (
          <Text style={styles.fallback}>{FALLBACK_CHAR}</Text>
        )}
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {app.name}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "30%",
    alignItems: "center",
    marginVertical: 12,
    marginHorizontal: "1.5%",
  },
  iconWrapper: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: "#1e293b",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 10,
  },
  fallback: {
    fontSize: 28,
    color: "#6366f1",
  },
  label: {
    marginTop: 6,
    fontSize: 12,
    color: "#cbd5e1",
    fontWeight: "600",
    textAlign: "center",
  },
});
