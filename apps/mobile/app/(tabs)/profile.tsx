import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";

import ProfileHeader from "../../components/ProfileHeader";
import { EmptyState } from "../../components/states/EmptyState";
import { ErrorState } from "../../components/states/ErrorState";
import { useNetwork } from "../../hooks/useNetwork";
import { useToast } from "../../context/ToastContext";
import { useWallet } from "../../hooks/useWallet";
import { useProfile } from "../../hooks/useProfile";

export default function ProfileScreen() {
  const router = useRouter();
  const { address, connected, connect, disconnect, error, refresh } = useWallet();
  const { networkLabel, contractId, rpcUrl } = useNetwork();
  const { showToast } = useToast();

  const {
    profile,
    loading: profileLoading,
    error: profileError,
    followerCount,
    followingCount,
    refresh: refreshProfile,
  } = useProfile(address ?? "");

  // Counts are still being resolved while profileLoading is true. Pass null in
  // that window so ProfileHeader renders the "—" placeholder instead of a
  // stale `0` that would briefly mislead the user.
  const resolvedFollowerCount = profileLoading ? null : followerCount;
  const resolvedFollowingCount = profileLoading ? null : followingCount;

  const copyAddress = async () => {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    showToast({ kind: "success", title: "Copied!", message: "Wallet address copied to clipboard." });
  };

  const errorMessage = error ?? profileError;

  if (errorMessage) {
    return <ErrorState message={errorMessage} onRetry={() => { refresh(); refreshProfile(); }} />;
  }

  return (
    <View style={styles.container}>
      {connected && address ? (
        <>
          <ProfileHeader
            profile={
              profile ?? {
                address,
                username: null,
                bio: null,
              }
            }
            followerCount={resolvedFollowerCount}
            followingCount={resolvedFollowingCount}
            isFollowing={false}
            isOwnProfile
            onFollowersPress={() =>
              router.push(
                `/profile/followers?address=${address}` as Parameters<typeof router.push>[0],
              )
            }
            onFollowingPress={() =>
              router.push(
                `/profile/following?address=${address}` as Parameters<typeof router.push>[0],
              )
            }
            onEditPress={() =>
              router.push("/profile/edit" as Parameters<typeof router.push>[0])
            }
            onToggleFollow={() => {
              // The Profile tab is always the wallet owner's own profile, so there
              // is no follow toggle to expose from this screen.
            }}
          />

          <View style={styles.panel}>
            <Text style={styles.eyebrow}>Wallet</Text>
            <TouchableOpacity onPress={copyAddress} activeOpacity={0.6}>
              <Text style={styles.address}>
                {address.slice(0, 8)}…{address.slice(-6)}
              </Text>
            </TouchableOpacity>
            <Text style={styles.meta}>{networkLabel} active</Text>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Contract ID</Text>
              <Text style={styles.detailValue}>{contractId}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>RPC URL</Text>
              <Text style={styles.detailValue}>{rpcUrl}</Text>
            </View>

            <TouchableOpacity
              style={styles.button}
              onPress={() =>
                router.push("/settings" as Parameters<typeof router.push>[0])
              }
            >
              <Text style={styles.buttonText}>Open settings</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={disconnect}>
              <Text style={styles.secondaryButtonText}>Disconnect</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <EmptyState
          icon="👤"
          title="Wallet disconnected"
          subtitle="Connect a wallet to view your profile and manage pool actions."
          actionLabel="Connect wallet"
          onAction={() => connect()}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
    padding: 24,
  },
  panel: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 20,
    padding: 18,
    marginTop: 16,
  },
  eyebrow: {
    color: "#818cf8",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  address: {
    fontSize: 15,
    color: "#e2e8f0",
    marginBottom: 8,
    fontFamily: "monospace",
    fontWeight: "700",
  },
  meta: {
    color: "#94a3b8",
    fontSize: 13,
    marginBottom: 16,
  },
  detailRow: {
    marginBottom: 12,
  },
  detailLabel: {
    color: "#94a3b8",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  detailValue: {
    color: "#e2e8f0",
    fontSize: 12,
    lineHeight: 18,
  },
  button: {
    backgroundColor: "#6366f1",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  secondaryButton: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  secondaryButtonText: {
    color: "#e2e8f0",
    fontWeight: "600",
    fontSize: 14,
  },
});
