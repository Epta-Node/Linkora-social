import React, { useState } from "react";
import { Alert, Linking, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { useWalletContext } from "../../context/WalletContext";
import { useTheme } from "../../theme/useTheme";

export default function WalletQrScanner() {
  const router = useRouter();
  const { connectWithPairingUri } = useWalletContext();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const { theme } = useTheme();

  if (!permission) return <View style={styles.center}><Text style={{ color: theme.colors.text.primary }}>Requesting camera permission…</Text></View>;
  if (!permission.granted) {
    return <View style={styles.center}>
      <Text style={[styles.title, { color: theme.colors.text.primary }]}>Camera access is needed</Text>
      <Text style={[styles.body, { color: theme.colors.text.secondary }]}>Allow camera access to scan a WalletConnect pairing QR code.</Text>
      <Text style={styles.action} onPress={permission.canAskAgain ? requestPermission : () => Linking.openSettings()}> {permission.canAskAgain ? "Allow camera" : "Open Settings"} </Text>
    </View>;
  }
  return <View style={styles.container}>
    <CameraView style={StyleSheet.absoluteFill} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={scanned ? undefined : async ({ data }) => {
      if (!data.startsWith("wc:")) { Alert.alert("Invalid QR code", "Scan a WalletConnect pairing QR code."); return; }
      setScanned(true);
      try { await connectWithPairingUri(data); router.back(); } catch (error) { setScanned(false); Alert.alert("Pairing failed", error instanceof Error ? error.message : "Try again."); }
    }} />
    <View style={styles.overlay}><Text style={styles.title}>Scan WalletConnect QR</Text><Text style={styles.body}>Point your camera at the code shown by your desktop wallet.</Text></View>
  </View>;
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: "#000" }, center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }, overlay: { marginTop: 80, marginHorizontal: 24, padding: 20, borderRadius: 16, backgroundColor: "rgba(0,0,0,.65)" }, title: { fontSize: 22, fontWeight: "800", color: "#fff", textAlign: "center" }, body: { marginTop: 10, fontSize: 15, lineHeight: 21, color: "#ddd", textAlign: "center" }, action: { marginTop: 20, color: "#7C3AED", fontSize: 16, fontWeight: "700" } });
