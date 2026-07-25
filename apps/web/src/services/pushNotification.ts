import { bytesToBase64 } from "../lib/dm/crypto";

// Configuration
const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || "http://localhost:3001";
const VAPID_PUBLIC_KEY = process.env.REACT_APP_VAPID_PUBLIC_KEY || "YOUR_PUBLIC_VAPID_KEY_HERE";

/**
 * Utility function to convert a standard base64 VAPID string
 * into a Uint8Array needed by the browser's PushManager subscription settings.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Registers the Service Worker (if not already done) and requests/retrieves
 * a unique PushSubscription object from the browser's PushManager.
 */
export async function registerServiceWorkerAndSubscribe(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    console.warn("Push messaging is not supported in this browser environment.");
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      const convertedKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey,
      });
    }

    return subscription;
  } catch (error) {
    console.error("Failed to subscribe user via browser Push API:", error);
    throw error;
  }
}

/**
 * Revokes the active push subscription token inside the client application browser instance.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();

  if (subscription) {
    return await subscription.unsubscribe();
  }
  return false;
}

async function sha256Web(data: Uint8Array): Promise<Uint8Array> {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
}

export async function buildStellarAuthHeader(address: string): Promise<string> {
  const timestamp = Date.now();
  const message = `${address}:${timestamp}`;
  const hash = await sha256Web(new TextEncoder().encode(message));

  const { signBlob } = await import("@stellar/freighter-api");
  const signBlobFn = signBlob as (
    payload: string,
    options: { accountToSign: string }
  ) => Promise<string>;
  const sigBase64 = await signBlobFn(bytesToBase64(hash), {
    accountToSign: address,
  });

  const payload = JSON.stringify({
    address,
    timestamp,
    signature: sigBase64,
  });

  const base64Payload = btoa(unescape(encodeURIComponent(payload)));
  return `StellarSig ${base64Payload}`;
}

export async function fetchPreferencesFromServer(address: string): Promise<any> {
  const authHeader = await buildStellarAuthHeader(address);
  const response = await fetch(`${INDEXER_URL}/api/notifications/preferences`, {
    method: "GET",
    headers: {
      Authorization: authHeader,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch preferences from database records.");
  }

  return await response.json();
}

/**
 * Transmits the structural toggles and the generated push encryption tokens
 * to your application database.
 */
export async function savePreferencesToBackend(
  address: string,
  preferences: any,
  subscription: PushSubscription | null
): Promise<any> {
  const authHeader = await buildStellarAuthHeader(address);
  const payload = {
    preferences,
    subscription: subscription ? subscription.toJSON() : null,
  };

  const response = await fetch(`${INDEXER_URL}/api/notifications/preferences`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Failed to synchronize preferences with database records.");
  }

  return await response.json();
}
