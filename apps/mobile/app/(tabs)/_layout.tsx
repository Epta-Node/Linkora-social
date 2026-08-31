import { Tabs, useRouter } from "expo-router";
import { Home, Compass, Droplets, LayoutGrid, User } from "lucide-react-native";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useNetwork } from "../../hooks/useNetwork";
import { useWallet } from "../../hooks/useWallet";
import { useTheme } from "../../theme/useTheme";

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

export function HeaderActions() {
  return (
    <View style={styles.headerActions}>
      <HeaderNetworkBadge />
      <HeaderWalletAddress />
    </View>
  );
}

/**
 * Bottom tab navigator. Lives under the root Stack (see app/_layout.tsx) so that
 * detail screens push on top of the tabs and gain the native swipe-back gesture
 * and header back button.
 */
export default function TabsLayout() {
  const { theme } = useTheme();

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
        tabBarActiveTintColor: theme.colors.brand.accent,
        tabBarInactiveTintColor: "#9ca3af",
        tabBarStyle: {
          backgroundColor: "#0f172a",
          borderTopColor: "#1e293b",
        },
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{
          title: "Feed",
          tabBarLabel: "Feed",
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: "Explore",
          tabBarLabel: "Explore",
          tabBarIcon: ({ color, size }) => <Compass color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="pools"
        options={{
          title: "Pools",
          tabBarLabel: "Pools",
          tabBarIcon: ({ color, size }) => <Droplets color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="mini-apps"
        options={{
          title: "Mini Apps",
          tabBarLabel: "Mini Apps",
          tabBarIcon: ({ color, size }) => <LayoutGrid color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarLabel: "Profile",
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
        }}
      />
    </Tabs>
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
