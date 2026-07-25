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

// Public VAPID Key configured from your environment variables
const VAPID_PUBLIC_KEY = process.env.REACT_APP_VAPID_PUBLIC_KEY || "YOUR_PUBLIC_VAPID_KEY_HERE";

export interface NotificationPreferences {
  address: string;
  follow_notifications: boolean;
  tip_notifications: boolean;
  like_notifications: boolean;
  moderation_notifications: boolean;
  governance_notifications: boolean;
  pool_notifications: boolean;
  post_notifications: boolean;
}

export interface NotificationPreferencePayload {
  follow_notifications?: boolean;
  tip_notifications?: boolean;
  like_notifications?: boolean;
  moderation_notifications?: boolean;
  governance_notifications?: boolean;
  pool_notifications?: boolean;
  post_notifications?: boolean;
}

/**
 * Registers the Service Worker (if not already done) and requests/retrieves
 * a unique PushSubscription object from the browser's PushManager.
 */
export async function registerServiceWorkerAndSubscribe(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    console.warn("Push messaging is not supported in this browser environments.");
    return null;
  }

  try {
    // 1. Wait for the service worker context to be ready
    const registration = await navigator.serviceWorker.ready;

    // 2. Look up if an existing subscription identifier is active
    let subscription = await registration.pushManager.getSubscription();

    // 3. If no active registration credentials exist, initialize a new registration prompt
    if (!subscription) {
      const convertedKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey as unknown as BufferSource,
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

/**
 * Fetches the current notification preferences for a given address from the backend.
 */
export async function getPreferencesFromBackend(
  address: string
): Promise<NotificationPreferences | null> {
  const response = await fetch(`/api/notifications/preferences/${address}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as NotificationPreferences | null;
}

/**
 * Transmits the structural toggles and the generated push encryption tokens
 * to your application database.
 */
export async function savePreferencesToBackend(
  address: string,
  preferences: NotificationPreferencePayload,
  subscription: PushSubscription | null
): Promise<void> {
  const response = await fetch(`/api/notifications/preferences/${address}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
    },
    body: JSON.stringify({
      ...preferences,
      subscription: subscription ? subscription.toJSON() : null,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to synchronize preferences with database records.");
  }
}
