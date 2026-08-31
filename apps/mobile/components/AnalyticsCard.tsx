import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTheme } from "../theme/useTheme";

interface AnalyticsAttestation {
  oracleName: string;
  reportHash: string;
  signature: string;
  txHash: string;
  submittedAt: number;
  report: {
    version: number;
    creator: string;
    windowStart: string;
    windowEnd: string;
    totalTips: string;
    postCount: string;
    followerDelta: string;
    uniqueTippers: number;
  };
}

interface AnalyticsCardProps {
  creatorAddress: string;
  oracleApiUrl?: string;
}

type State =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "loaded"; data: AnalyticsAttestation };

function formatStroops(value: string): string {
  const n = BigInt(value);
  if (n === 0n) return "0";
  const whole = n / 10_000_000n;
  const frac = n % 10_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(7, "0").replace(/0+$/, "")}`;
}

export function AnalyticsCard({ creatorAddress, oracleApiUrl }: AnalyticsCardProps) {
  const { theme } = useTheme();
  const styles = createStyles(theme);
  const baseUrl = oracleApiUrl ?? process.env["EXPO_PUBLIC_ORACLE_API_URL"] ?? "";
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!baseUrl || !creatorAddress) { setState({ status: "empty" }); return; }
    let cancelled = false;
    fetch(`${baseUrl}/attestations/${creatorAddress}`)
      .then((res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`oracle error: ${res.status}`);
        return res.json() as Promise<AnalyticsAttestation>;
      })
      .then((data) => {
        if (!cancelled) setState(data ? { status: "loaded", data } : { status: "empty" });
      })
      .catch(() => { if (!cancelled) setState({ status: "empty" }); });
    return () => { cancelled = true; };
  }, [baseUrl, creatorAddress]);

  if (state.status === "loading") {
    return (
      <View style={styles.skeleton} accessible accessibilityLabel="Loading analytics">
        <ActivityIndicator size="small" color={theme.colors.brand.primary} />
      </View>
    );
  }

  if (state.status === "empty") return null;

  const { report, txHash, submittedAt } = state.data;
  const explorerUrl = `https://stellar.expert/explorer/testnet/tx/${txHash}`;

  return (
    <View style={styles.card} accessible accessibilityLabel="Creator analytics">
      <View style={styles.header}>
        <Text style={styles.badge}>✅ Verified by oracle</Text>
        <TouchableOpacity onPress={() => Linking.openURL(explorerUrl)} accessibilityRole="link" accessibilityLabel="View on-chain attestation">
          <Text style={styles.link}>On-chain ↗</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.grid}>
        <Stat theme={theme} label="Total Tips" value={`${formatStroops(report.totalTips)} XLM`} />
        <Stat theme={theme} label="Posts" value={report.postCount} />
        <Stat theme={theme} label="Follower Δ" value={Number(report.followerDelta) >= 0 ? `+${report.followerDelta}` : report.followerDelta} />
        <Stat theme={theme} label="Tippers" value={String(report.uniqueTippers)} />
      </View>

      <Text style={styles.window}>
        Ledgers {report.windowStart}–{report.windowEnd} · {new Date(submittedAt).toLocaleDateString()}
      </Text>
    </View>
  );
}

function Stat({
  label,
  value,
  theme,
}: {
  label: string;
  value: string | number;
  theme: ReturnType<typeof useTheme>["theme"];
}) {
  const styles = createStyles(theme);
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{String(value)}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    skeleton: {
      height: 80,
      borderRadius: 12,
      backgroundColor: theme.colors.surface.surface1,
      marginBottom: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    card: {
      backgroundColor: theme.colors.surface.surface1,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: theme.colors.surface.border,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12,
    },
    badge: {
      fontSize: 12,
      fontWeight: "600",
      color: theme.colors.text.secondary,
    },
    link: {
      fontSize: 12,
      color: theme.colors.brand.primary,
    },
    grid: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    stat: {
      flex: 1,
      alignItems: "center",
    },
    statValue: {
      fontSize: 14,
      fontWeight: "700",
      color: theme.colors.text.primary,
    },
    statLabel: {
      fontSize: 11,
      color: theme.colors.text.secondary,
      marginTop: 2,
    },
    window: {
      fontSize: 11,
      color: theme.colors.text.secondary,
    },
  });
}
