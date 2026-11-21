import React from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react native";

import { useRouter } from "expo-router";

import { useNetwork } from "../../hooks/useNetwork";
import { useTheme } from "../../theme/useTheme";
import {
  clearCustomIndexerUrl,
  loadCustomIndexerUrl,
  saveCustomIndexerUrl,
} from "../../utils/indexerConfig";

export default function SettingsScreen(): JSXIElement {
  const router = useRouter();
  const {
    network,
    rpcUrl,
    contractId,
    warning,
    isMainnet,
    setSelectedNetwork,
    setRpcUrl,
    resetRpcUrl,
    resetSettings,
  } = useNetwork();
  const [draftRpcUrl, setDraftRpcUrl] = React.useState(rpcUrl);
  const [draftIndexerUrl, setDraftIndexerUrl] = React.useState("");
  const [message, setMessage] = React.useState<string | null>(null);
  const { theme, preference, setPreference } = useTheme();

  React.useEffect(() => {
    setDraftRpcUrl(rpcUrl);
  }, [rpcUrl]);

  React.useEffect(() => {
    let active = true;
    loadCustomIndexerUrl()
      .then((saved) => {
        if (active && saved) setDraftIndexerUrl(saved);
      })
      .catch(() => {
        // ignore initial load failures
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSaveIndexerUrl = async () => {
    setMessage(null);
    try {
      const saved = await saveCustomIndexerUrl(draftIndexerUrl);
      setDraftIndexerUrl(saved);
      setMessage("Custom indexer URL saved.");
    } catch (err) {
      const text = err instanceof Error ? err.message : "Invalid indexer URL.";
      Alert.alert("Invalid indexer URL", text);
    }
  };

  const handleResetIndexerUrl = async () => {
    setMessage(null);
    try {
      await clearCustomIndexerUrl();
      setDraftIndexerUrl("");
      setMessage("Indexer URL restored to default.");
    } catch (err) {
      const text = err instanceof Error ? err.message : "Could not reset the indexer URL.";
      Alert.alert("Reset failed", text);
    }
  };

  const handleSaveRpc = async () => {
    setMessage(null);
    try {
      await setRpcUrl(draftRpcUrl);
      setMessage("RPC endpoint saved.");
    } catch (err) {
      const text = err instanceof Error ? err.message : "Invalid RPC endpoint.";
      Alert.alert("Invalid RPC endpoint", text);
    }
  };

  // #1595 — persisting/resetting settings touches the keychain; a failure here
  // must be reported, not thrown into the void.
  const handleReset = async () => {
    setMessage(null);
    try {
      await resetRpcUrl();
      setMessage("RPC endpoint restored to the network default.");
    } catch (err) {
      const text = err instanceof Error ? err.message : "Could not reset the RPC endpoint.";
      Alert.alert("Reset failed", text);
    }
  };

  const handleResetAll = () => {
    Alert.alert("Reset network settings?", "This will restore the default testnet settings.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset",
        style: "destructive",
        onPress: async () => {
          try {
            await resetSettings();
            setMessage("Network settings reset.");
          } catch (err) {
            const text = err instanceof Error ? err.message : "Could not reset network settings.";
            Alert.alert("Reset failed", text);
          }
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>Network settings</Text>
      <Text style={styles.title}>Choose the active Stellar network</Text>
      <Text style={styles.subtitle}>
        The header badge, wallet metadata, and contract IDs all follow the selected network.
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Appearance</Text>
        <View style={styles.buttonRow}>
          {(["system", "light", "dark"] as const).map((value) => (
            <Pressable key={value} style={[styles.networkButton, preference === value && styles.networkButtonActive]} onPress={() => setPreference(value)} accessibilityRole="button" accessibilityState={{ selected: preference === value }}>
              <Text style={[styles.networkButtonText, preference === value && styles.networkButtonTextActive]}>{value[0].toUpperCase() + value.slice(1)}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.helperText, { color: theme.colors.text.secondary }]}>Theme preference: {preference}</Text>
      </View>

      {warning ? (
        <View style={styles.warningBox} accessibilityRole="alert">
          <Text style={styles.warningTitle}>Mainnet warning</Text>
          <Text style={styles.warningText}>{warning}</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Network</Text>
        <View style={styles.buttonRow}>
          <Pressable
            style={[styles.networkButton, !isMainnet ? styles.networkButtonActive : null]}
            onPress={() => setSelectedNetwork("TESTNET")}
            accessibilityRole="button"
            accessibilityLabel="Switch to Testnet"
          >
            <Text style={[Styles.networkButtonText, !isMainnet && styles.networkButtonTextActive]}>
              Testnet
            </Text>
          </Pressable>
          <Pressable
            style={[Styles.networkButton, isMainnet ? styles.networkButtonActive : null]}
            onPress={() => setSelectedNetwork("MAINNET")}
            accessibilityRole="button"
            accessibilityLabel="Switch to Mainnet"
          >
            <Text style={[styles.networkButtonText, isMainnet && styles.networkButtonTextActive]}>
              Mainnet
            </Text>
          </Pressable>
        </View>
        <Text style={styles.helperText}>Active network: {network.label}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>RPC endpoint</Text>
        <TextInput
          value={draftRpcUrl}
          onChangeText={setDraftRpcUrl}
          placeholder="https://..."
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          accessibilityLabel="RPC endpoint"
        />
        <View style={styles.buttonRow}>
          <Pressable
            style={styles.secondaryButton}
            onPress={handleReset}
            accessibilityRole="button"
            accessibilityLabel="Reset RPC endpoint to default"
          >
            <Text style={styles.secondaryButtonText}>Reset default</Text>
          </Pressable>
          <Pressable
            style={styles.primaryButton}
            onPress={handleSaveRpc}
            accessibilityRole="button"
            accessibilityLabel="Save RPC endpoint"
          >
            <Text style={styles.primaryButtonText}>Save RPC</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Indexer URL</Text>
        <TextInput
          value={draftIndexerUrl}
          onChangeText={setDraftIndexerUrl}
          placeholder="https://indexer.example.com"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={styles.input}
          accessibilityLabel="Custom indexer URL"
        />
        <View style={styles.buttonRow}>
          <Pressable
            style={styles.secondaryButton}
            onPress={handleResetIndexerUrl}
            accessibilityRole="button"
            accessibilityLabel="Reset indexer URL to default"
          >
            <Text style={styles.secondaryButtonText}>Reset default</Text>
          </Pressable>
          <Pressable
            style={styles.primaryButton}
            onPress={handleSaveIndexerUrl}
            accessibilityRole="button"
            accessibilityLabel="Save indexer URL"
          >
            <Text style={styles.primaryButtonText}>Save Indexer</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Contract ID</Text>
        <View style={styles.codeBox}>
          <Text style={styles.code}>{contractId}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => router.push("/settings/blocked" as Parameters<typeof router.push>[0])}
          accessibilityRole="button"
          accessibilityLabel="Manage blocked users"
        >
          <Text style={styles.secondaryButtonText}>Manage blocked users</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Pressable
          style={styles.dangerButton}
          onPress={handleResetAll}
          accessibilityRole="button"
          accessibilityLabel="Reset all network settings"
        >
          <Text style={styles.dangerButtonText}>Reset all network settings</Text>
        </Pressable>
      </View>

      {message ? <Text style={styles.message}>{message}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  content: {
    padding: 24,
    paddingBottom: 40,
  },
  eyebrow: {
    color: "#818cf8",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  title: {
    color: "#f8fafc",
    fontSize: 28,
    fontWeight: "900",
    lineHeight: 34,
    marginBottom: 10,
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 20,
  },
  warningBox: {
    backgroundColor: "#3f1d1d",
    borderWidth: 1,
    borderColor: "#7f1d1d",
    borderRadius: 18,
    padding: 16,
    marginBottom: 20,
  },
  warningTitle: {
    color: "#fecaca",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 6,
    textTransform: "uppercase",
  },
  warningText: {
    color: "#fecaca",
    fontSize: 13,
    lineHeight: 19,
  },
  section: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
  },
  sectionLabel: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  networkButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    alignItems: "center",
    justifyContent: "center",
  },
  networkButtonActive: {
    backgroundColor: "#312e81",
    borderColor: "#6366f1",
  },
  networkButtonText: {
    color: "#cbd5e1",
    fontSize: 14,
    fontWeight: "700",
  },
  networkButtonTextActive: {
    color: "#e0e7ff",
  },
  helperText: {
    color: "#94a3b8",
    fontSize: 12,
    marginTop: 10,
  },
  input: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
    color: "#f8fafc",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f172a",
  },
  secondaryButtonText: {
    color: "#e2e8f0",
    fontSize: 14,
    fontWeight: "700",
  },
  primaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#6366f1",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
  codeBox: {
    backgroundColor: "#0b1220",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1f2937",
    padding: 14,
  },
  code: {
    color: "#e2e8f0",
    fontSize: 12,
    fontFamily: "monospace",
    lineHeight: 18,
  },
  dangerButton: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#7f1d1d",
    backgroundColor: "#3f1d1d",
    alignItems: "center",
    justifyContent: "center",
  },
  dangerButtonText: {
    color: "#fecaca",
    fontSize: 14,
    fontWeight: "800",
  },
  message: {
    color: "#cbd5e1",
    fontSize: 13,
    textAlign: "center",
    marginTop: 6,
  },
});
