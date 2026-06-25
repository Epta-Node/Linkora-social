import { Tabs, useRouter } from "expo-router";
import { useEffect } from "react";
import { Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { setupNotificationListeners } from "../notifications/notificationHandler";
import { registerForPushNotificationsAsync } from "../notifications/registerForPushNotifications";

import { WalletProvider } from "../context/WalletContext";
import { ToastProvider } from "../context/ToastContext";
import { NetworkProvider } from "../context/NetworkContext";
import { useNetwork } from "../hooks/useNetwork";
import { useWallet } from "../hooks/useWallet";
import { parseDeepLink } from "../utils/deepLinks";
import { useTheme } from "../theme/useTheme";

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function HeaderWalletAddress() {
  const { theme } = useTheme();
  const router = useRouter();
  const { address, connected } = useWallet();

  return (
    <TouchableOpacity
      style={[
        styles.headerWallet,
        {
          backgroundColor: theme.colors.surface.surface1,
          borderColor: theme.colors.surface.border,
        },
      ]}
      onPress={() => router.push("/connect" as Parameters<typeof router.push>[0])}
      accessibilityRole="button"
      accessibilityLabel={
        connected && address ? `Connected wallet ${address}` : "Open wallet connection screen"
      }
    >
      <Text style={[styles.headerWalletText, { color: theme.colors.text.primary }]}>
        {connected && address ? shortAddress(address) : "Connect"}
      </Text>
    </TouchableOpacity>
  );
}

function HeaderNetworkBadge() {
  const router = useRouter();
  const { network, isMainnet } = useNetwork();

  return (
    <TouchableOpacity
      style={[styles.networkBadge, isMainnet && styles.networkBadgeMainnet]}
      onPress={() => router.push("/settings" as Parameters<typeof router.push>[0])}
      accessibilityRole="button"
      accessibilityLabel={`Open network settings. Active network ${network.label}`}
    >
      <Text style={[styles.networkBadgeText, isMainnet && styles.networkBadgeTextMainnet]}>
        {network.label}
      </Text>
    </TouchableOpacity>
  );
}

function HeaderActions() {
  return (
    <View style={styles.headerActions}>
      <HeaderNetworkBadge />
      <HeaderWalletAddress />
    </View>
  );
}

/**
 * Root layout — wraps the entire app in WalletProvider and sets up
 * the bottom tab navigator with deep-link handling.
 *
 * Screens:
 *   (tabs)/feed        — main post feed
 *   (tabs)/explore     — discovery / search
 *   (tabs)/pools       — community pools
 *   (tabs)/mini-apps   — mini app browser
 *   (tabs)/profile     — user profile
 *
 * Stack screens (detail views) are declared as modal/stack routes
 * alongside the tabs via the Tabs.Screen `href` opt-out pattern.
 */
function AppNavigator() {
  const router = useRouter();
  const { address, connected } = useWallet();

  useEffect(() => {
    let isMounted = true;

    async function handleInitialUrl() {
      let initialUrl: string | null = null;
      try {
        initialUrl = await Linking.getInitialURL();
      } catch {
        return;
      }
      if (isMounted && initialUrl) {
        handleDeepLink(initialUrl);
      }
    }

    function handleDeepLink(url: string) {
      const deepLink = parseDeepLink(url);
      if (!deepLink) return;
      router.push(deepLink.path as Parameters<typeof router.push>[0]);
    }

    const subscription = Linking.addEventListener("url", ({ url }) => {
      handleDeepLink(url);
    });

    handleInitialUrl();

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [router]);

  useEffect(() => setupNotificationListeners(), []);

  useEffect(() => {
    if (!connected || !address) {
      return;
    }

    void registerForPushNotificationsAsync(address);
  }, [address, connected]);

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: {
          backgroundColor: "#0f172a",
        },
        headerTitleStyle: {
          color: "#f8fafc",
          fontWeight: "700",
        },
        headerTintColor: "#f8fafc",
        headerRight: () => <HeaderActions />,
        tabBarActiveTintColor: "#6366f1",
        tabBarInactiveTintColor: "#9ca3af",
        tabBarStyle: {
          backgroundColor: "#0f172a",
          borderTopColor: "#1e293b",
        },
      }}
    >
      <Tabs.Screen name="(tabs)/feed" options={{ title: "Feed", tabBarLabel: "Feed" }} />
      <Tabs.Screen name="(tabs)/explore" options={{ title: "Explore", tabBarLabel: "Explore" }} />
      <Tabs.Screen name="(tabs)/pools" options={{ title: "Pools", tabBarLabel: "Pools" }} />
      <Tabs.Screen
        name="(tabs)/mini-apps"
        options={{ title: "Mini Apps", tabBarLabel: "Mini Apps" }}
      />
      <Tabs.Screen name="(tabs)/profile" options={{ title: "Profile", tabBarLabel: "Profile" }} />
      <Tabs.Screen name="connect" options={{ href: null, title: "Connect Wallet" }} />
      {/* Detail screens — hidden from tab bar */}
      <Tabs.Screen name="post/[id]" options={{ href: null, headerShown: true, title: "Post" }} />
      <Tabs.Screen
        name="mini-app/[id]"
        options={{ href: null, headerShown: true, title: "Mini App" }}
      />
      <Tabs.Screen
        name="mini-app/create-post"
        options={{ href: null, headerShown: true, title: "Create Post" }}
      />
      <Tabs.Screen
        name="profile/[address]"
        options={{ href: null, headerShown: true, title: "Profile" }}
      />
      <Tabs.Screen name="pool/[id]" options={{ href: null, headerShown: true, title: "Pool" }} />
      <Tabs.Screen name="pools/[id]" options={{ href: null, headerShown: true, title: "Pool" }} />
      <Tabs.Screen
        name="dm/[address]"
        options={{ href: null, headerShown: true, title: "Direct Message" }}
      />
    </Tabs>
  );
}

export default function RootLayout() {
  return (
    <NetworkProvider>
      <WalletProvider>
        <ToastProvider>
          <AppNavigator />
        </ToastProvider>
      </WalletProvider>
    </NetworkProvider>
  );
}

const styles = StyleSheet.create({
  headerWallet: {
    minHeight: 32,
    minWidth: 82,
    borderRadius: 16,
    marginRight: 12,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  headerWalletText: {
    fontSize: 12,
    fontWeight: "700",
    fontFamily: "monospace",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginRight: 12,
  },
  networkBadge: {
    minHeight: 32,
    borderRadius: 16,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
  },
  networkBadgeMainnet: {
    backgroundColor: "#3f1d1d",
    borderColor: "#7f1d1d",
  },
  networkBadgeText: {
    color: "#cbd5e1",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  networkBadgeTextMainnet: {
    color: "#fecaca",
  },
});
