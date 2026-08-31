import { Stack, useRouter } from "expo-router";
import { useEffect } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";

import { setupNotificationListeners } from "../notifications/notificationHandler";
import { registerForPushNotificationsAsync } from "../notifications/registerForPushNotifications";

import { WalletProvider } from "../context/WalletContext";
import { ToastProvider } from "../context/ToastContext";
import { NetworkProvider } from "../context/NetworkContext";
import { useNetwork } from "../hooks/useNetwork";
import { useWallet } from "../hooks/useWallet";
import { parseDeepLink } from "../utils/deepLinks";
import { HeaderActions } from "./(tabs)/_layout";

/**
 * Root layout — wraps the entire app in the providers and mounts a Stack
 * navigator. The bottom tabs live in the `(tabs)` group (app/(tabs)/_layout.tsx)
 * and are pushed as a single stack entry, while detail views (post/[id],
 * profile/[address], pool/[id], dm/[address], ...) push on top of it. Pushing
 * onto a Stack is what gives detail screens the native iOS swipe-back gesture
 * and the Android header back button.
 *
 * Deep-link handling, notification listeners and push-token registration are
 * app-wide concerns and live here.
 */
function RootNavigator() {
  const router = useRouter();
  const { address, connected } = useWallet();
  const { isOffline } = useNetwork();

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
    <>
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>No internet connection</Text>
        </View>
      )}
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: "#0f172a",
          },
          headerTitleStyle: {
            color: "#f8fafc",
            fontWeight: "700",
          },
          headerTintColor: "#f8fafc",
          headerRight: () => <HeaderActions />,
        }}
      >
        {/* The tab navigator renders its own headers. */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {/* Detail screens — pushed on top of the tabs, with a back button. */}
        <Stack.Screen name="connect" options={{ title: "Connect Wallet" }} />
        <Stack.Screen name="post/[id]" options={{ title: "Post" }} />
        <Stack.Screen name="mini-app/[id]" options={{ title: "Mini App" }} />
        <Stack.Screen name="mini-app/create-post" options={{ title: "Create Post" }} />
        <Stack.Screen name="profile/[address]" options={{ title: "Profile" }} />
        <Stack.Screen name="pool/[id]" options={{ title: "Pool" }} />
        <Stack.Screen name="pools/[id]" options={{ title: "Pool" }} />
        <Stack.Screen name="dm/[address]" options={{ title: "Direct Message" }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <NetworkProvider>
      <WalletProvider>
        <ToastProvider>
          <RootNavigator />
        </ToastProvider>
      </WalletProvider>
    </NetworkProvider>
  );
}

const styles = StyleSheet.create({
  offlineBanner: {
    backgroundColor: "#ef4444",
    paddingTop: 48,
    paddingBottom: 8,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
  offlineBannerText: {
    color: "#ffffff",
    fontWeight: "bold",
    fontSize: 14,
  },
});
