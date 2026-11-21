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
import { ThemeProvider, useTheme } from "../theme/useTheme";

/**
 * Expo Router / React Navigation linking configuration.
 * Declares every deep-link pattern the app handles so the OS hands the URL
 * to the navigator rather than opening a browser.  The route handler in
 * RootNavigator still validates every URL through parseDeepLink before
 * navigating — this config is purely for OS-level intent registration.
 *
 * Supported schemes:
 *   linkora://profile/<address>
 *   linkora://post/<id>
 *   linkora://pool/<id>
 *   linkora://dm/<address>
 *   https://linkora.social/<resource>/<id>  (universal links / App Links)
 */
const LINKING_CONFIG = {
  prefixes: ["linkora://", "https://linkora.social", "https://www.linkora.social"],
  config: {
    screens: {
      "(tabs)": {
        screens: {
          feed: "feed",
          explore: "explore",
          pools: "pools",
          profile: "profile",
          "mini-apps": "mini-apps",
        },
      },
      "post/[id]": "post/:id",
      "profile/[address]": "profile/:address",
      "pools/[id]": "pool/:id",
      "dm/[address]": "dm/:address",
      "dm/index": "dm",
      "mini-app/[id]": "mini-app/:id",
      connect: "connect",
    },
  },
};

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
  const { theme } = useTheme();

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
      // #1555 — parseDeepLink is the single validator for every externally
      // supplied route. A cold start and a warm `url` event take the identical
      // path, and anything it rejects is not navigated to.
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
            backgroundColor: theme.colors.surface.surface1,
          },
          headerTitleStyle: {
            color: theme.colors.text.primary,
            fontWeight: "700",
          },
          headerTintColor: theme.colors.text.primary,
          headerRight: () => <HeaderActions />,
        }}
      >
        {/* The tab navigator renders its own headers. */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {/* Detail screens — pushed on top of the tabs, with a back button. */}
        <Stack.Screen name="connect" options={{ title: "Connect Wallet" }} />
        <Stack.Screen name="wallet/scan" options={{ title: "Scan WalletConnect QR" }} />
        <Stack.Screen name="wallet/qr" options={{ title: "WalletConnect QR" }} />
        <Stack.Screen
          name="post/[id]"
          options={{
            title: "Post",
            gestureEnabled: true,
            gestureDirection: "horizontal",
            fullScreenGestureEnabled: false,
            animation: "slide_from_right",
            animationDuration: 250,
          }}
        />
        <Stack.Screen name="mini-app/[id]" options={{ title: "Mini App" }} />
        <Stack.Screen name="mini-app/create-post" options={{ title: "Create Post" }} />
        <Stack.Screen name="profile/[address]" options={{ title: "Profile" }} />
        <Stack.Screen name="pool/[id]" options={{ title: "Pool" }} />
        <Stack.Screen name="pools/[id]" options={{ title: "Pool" }} />
        <Stack.Screen name="dm/[address]" options={{ title: "Direct Message" }} />
        <Stack.Screen name="dm/index" options={{ title: "Messages" }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <NetworkProvider>
        <WalletProvider>
          <ToastProvider>
            <RootNavigator />
          </ToastProvider>
        </WalletProvider>
      </NetworkProvider>
    </ThemeProvider>
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
