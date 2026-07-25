import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const SECURE_STORE_PUSH_TOKEN_KEY = "linkora_push_token";

async function registerTokenWithIndexer(address: string, token: string, platform: string) {
  const indexerUrl = process.env.EXPO_PUBLIC_INDEXER_URL;
  if (!indexerUrl || !address) {
    return;
  }

  await fetch(`${indexerUrl.replace(/\/$/, "")}/api/notifications/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ address, token, platform }),
  });
}

export async function registerForPushNotificationsAsync(
  address?: string | null
): Promise<string | null> {
  let token: string | null = null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    return null;
  }

  try {
    const expoToken = await Notifications.getExpoPushTokenAsync();
    token = expoToken.data;
    if (token) {
      await SecureStore.setItemAsync(SECURE_STORE_PUSH_TOKEN_KEY, token);
      if (address) {
        await registerTokenWithIndexer(address, token, Platform.OS);
      }
    }
  } catch (error) {
    console.error("Error getting or storing push token", error);
  }

  return token;
}

export async function getStoredPushTokenAsync(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SECURE_STORE_PUSH_TOKEN_KEY);
  } catch (error) {
    console.error("Error retrieving push token from secure store", error);
    return null;
  }
}

export async function deregisterTokenFromIndexer(address: string): Promise<void> {
  const indexerUrl = process.env.EXPO_PUBLIC_INDEXER_URL;
  if (!indexerUrl || !address) {
    return;
  }

  try {
    await fetch(`${indexerUrl.replace(/\/$/, "")}/api/notifications/deregister`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ address }),
    });
  } catch (error) {
    console.error("Error deregistering push token with indexer", error);
  }
}
