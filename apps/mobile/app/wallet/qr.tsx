import React from "react";
import { StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useLocalSearchParams } from "expo-router";
import { useTheme } from "../../theme/useTheme";

export default function WalletPairingQr() {
  const { uri } = useLocalSearchParams<{ uri?: string }>();
  const { theme } = useTheme();
  return <View style={[styles.container, { backgroundColor: theme.colors.surface.background }]}>
    <Text style={[styles.title, { color: theme.colors.text.primary }]}>Connect a desktop wallet</Text>
    <Text style={[styles.body, { color: theme.colors.text.secondary }]}>Scan this WalletConnect code from your desktop wallet.</Text>
    {uri ? <QRCode value={uri} size={240} backgroundColor="white" color="black" /> : <Text style={{ color: theme.colors.semantic.error }}>No pairing URI available</Text>}
  </View>;
}
const styles = StyleSheet.create({ container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }, title: { fontSize: 24, fontWeight: "800" }, body: { marginVertical: 20, textAlign: "center", fontSize: 15 } });
