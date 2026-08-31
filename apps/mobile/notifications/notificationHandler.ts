import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { parseDeepLink } from "../utils/deepLinks";

// Configure how notifications are handled when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export interface NotificationPayload {
  type:
    | "NEW_FOLLOWER"
    | "TIP_RECEIVED"
    | "LIKE_RECEIVED"
    | "POOL_ACTIVITY"
    | "POST_REPORTED"
    | "REPORT_DISMISSED"
    | "POST_REMOVED_BY_MODERATION";
  followerAddress?: string;
  senderAddress?: string;
  amount?: string;
  asset?: string;
  poolId?: string;
  postId?: string;
  activityType?: string;
  reason?: string;
  moderatorNotes?: string;
  deepLink?: string;
}

/** Screen shown when a notification's payload can't be resolved to a specific route. */
const FALLBACK_ROUTE = "/(tabs)/explore";

function navigateToDeepLink(value?: string): boolean {
  if (!value) {
    return false;
  }

  if (
    value.startsWith("/post/") ||
    value.startsWith("/profile/") ||
    value.startsWith("/pools/") ||
    value.startsWith("/dm/")
  ) {
    router.push(value as Parameters<typeof router.push>[0]);
    return true;
  }

  const parsed = parseDeepLink(value);
  if (!parsed) {
    return false;
  }

  router.push(parsed.path as Parameters<typeof router.push>[0]);
  return true;
}

/**
 * Explicit notification type -> route fallback, used when `deepLink` is missing or
 * fails to parse. Centralized here so route-building logic doesn't drift between the
 * notification handler and `utils/deepLinks.ts`.
 */
function fallbackRouteFor(data: NotificationPayload): string | null {
  switch (data.type) {
    case "NEW_FOLLOWER":
      return data.followerAddress ? `/profile/${data.followerAddress}` : null;
    case "TIP_RECEIVED":
    case "LIKE_RECEIVED":
    case "POST_REPORTED":
    case "REPORT_DISMISSED":
    case "POST_REMOVED_BY_MODERATION":
      return data.postId ? `/post/${data.postId}` : null;
    case "POOL_ACTIVITY":
      return data.poolId ? `/pools/${data.poolId}` : null;
    default:
      return null;
  }
}

/** Navigate to the screen a tapped notification should open, with a safe fallback. */
function navigateForNotification(data: NotificationPayload): void {
  if (navigateToDeepLink(data.deepLink)) {
    return;
  }

  const fallback = fallbackRouteFor(data);
  router.push((fallback ?? FALLBACK_ROUTE) as Parameters<typeof router.push>[0]);
}

export function setupNotificationListeners() {
  // Listener for foreground notifications
  const notificationListener = Notifications.addNotificationReceivedListener((notification) => {
    console.log("Notification received in foreground:", notification);
  });

  // Listener for notification taps (when user interacts with a notification)
  const responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as unknown as NotificationPayload;
    console.log("Notification response (tap) received:", data);

    if (!data || !data.type) {
      router.push(FALLBACK_ROUTE as Parameters<typeof router.push>[0]);
      return;
    }

    navigateForNotification(data);
  });

  return () => {
    notificationListener.remove();
    responseListener.remove();
  };
}
