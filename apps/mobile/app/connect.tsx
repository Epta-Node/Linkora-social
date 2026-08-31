import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { WalletButton } from "../components/WalletButton";
import { useWallet } from "../hooks/useWallet";
import type { WalletProviderKind } from "../context/WalletContext";
import { useTheme } from "../theme/useTheme";

function shortAddress(address: string): string {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

export default function ConnectScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { address, connected, disconnect, connect, error, state, wallet } = useWallet();

  const handleConnect = async (provider: WalletProviderKind) => {
    await connect(provider);
  };

  const handleDisconnect = async () => {
    await disconnect();
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>Linkora Wallet</Text>
        <Text style={styles.title}>Connect your Stellar wallet</Text>
        <Text style={styles.subtitle}>
          Use Freighter in browser contexts or WalletConnect for mobile wallets.
        </Text>

        {connected && address ? (
          <View style={styles.connectedPanel}>
            <Text style={styles.panelLabel}>Connected address</Text>
            <Text style={styles.address}>{shortAddress(address)}</Text>
            <Text style={styles.provider}>
              {wallet.provider === "freighter" ? "Freighter" : "WalletConnect"}
            </Text>
            <WalletButton
              label="Continue"
              accessibilityLabel="Continue to feed"
              onPress={() => router.replace("/(tabs)/feed")}
              state={state}
              style={styles.action}
            />
            <WalletButton
              label="Disconnect"
              accessibilityLabel="Disconnect wallet"
              onPress={handleDisconnect}
              state={state}
              variant="danger"
            />
          </View>
        ) : (
          <View style={styles.buttonStack}>
            <WalletButton
              label="Connect Freighter"
              accessibilityLabel="Connect with Freighter wallet"
              onPress={() => handleConnect("freighter")}
              provider="freighter"
              state={state}
            />
            <WalletButton
              label="Connect WalletConnect"
              accessibilityLabel="Connect with WalletConnect wallet"
              onPress={() => handleConnect("walletconnect")}
              provider="walletconnect"
              state={state}
              variant="secondary"
            />
          </View>
        )}

        {error ? (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.surface.background,
    },
    content: {
      flex: 1,
      padding: 24,
      justifyContent: "center",
    },
    eyebrow: {
      color: theme.colors.brand.secondary,
      fontSize: 12,
      fontWeight: "700",
      marginBottom: 8,
      textTransform: "uppercase",
    },
    title: {
      color: theme.colors.text.primary,
      fontSize: 30,
      fontWeight: "800",
      marginBottom: 10,
    },
    subtitle: {
      color: theme.colors.text.secondary,
      fontSize: 15,
      lineHeight: 22,
      marginBottom: 28,
    },
    buttonStack: {
      gap: 12,
    },
    connectedPanel: {
      backgroundColor: theme.colors.surface.surface1,
      borderColor: theme.colors.surface.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 16,
    },
    panelLabel: {
      color: theme.colors.text.secondary,
      fontSize: 12,
      marginBottom: 6,
    },
    address: {
      color: theme.colors.text.primary,
      fontFamily: "monospace",
      fontSize: 16,
      fontWeight: "700",
    },
    provider: {
      color: theme.colors.text.secondary,
      fontSize: 13,
      marginTop: 6,
      marginBottom: 16,
    },
    action: {
      marginBottom: 10,
    },
    errorBox: {
      backgroundColor: theme.colors.semantic.errorLight,
      borderColor: theme.colors.semantic.error,
      borderWidth: 1,
      borderRadius: 10,
      padding: 12,
      marginTop: 16,
    },
    errorText: {
      color: theme.colors.semantic.error,
      fontSize: 13,
    },
  });
}
