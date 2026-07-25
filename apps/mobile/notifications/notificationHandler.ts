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
  type: "NEW_FOLLOWER" | "TIP_RECEIVED" | "LIKE_RECEIVED" | "POOL_ACTIVITY";
  followerAddress?: string;
  senderAddress?: string;
  amount?: string;
  asset?: string;
  poolId?: string;
  postId?: string;
  activityType?: string;
  deepLink?: string;
}

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

export function setupNotificationListeners() {
  // Listener for foreground notifications
  const notificationListener = Notifications.addNotificationReceivedListener((notification) => {
    console.log("Notification received in foreground:", notification);
  });

  // Listener for notification taps (when user interacts with a notification)
  const responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as unknown as NotificationPayload;
    console.log("Notification response (tap) received:", data);

    if (!data || !data.type) return;

    switch (data.type) {
      case "NEW_FOLLOWER":
        if (navigateToDeepLink(data.deepLink)) {
          break;
        }
        if (data.followerAddress) {
          router.push(`/profile/${data.followerAddress}` as Parameters<typeof router.push>[0]);
        }
        break;
      case "TIP_RECEIVED":
        if (navigateToDeepLink(data.deepLink)) {
          break;
        }
        if (data.postId) {
          router.push(`/post/${data.postId}` as Parameters<typeof router.push>[0]);
        }
        break;
      case "LIKE_RECEIVED":
        if (navigateToDeepLink(data.deepLink)) {
          break;
        }
        if (data.postId) {
          router.push(`/post/${data.postId}` as Parameters<typeof router.push>[0]);
        }
        break;
      case "POOL_ACTIVITY":
        if (data.poolId) {
          router.push(`/pools/${data.poolId}` as Parameters<typeof router.push>[0]);
        }
        break;
      default:
        console.warn("Unknown notification type:", data.type);
    }
  });

  return () => {
    notificationListener.remove();
    responseListener.remove();
  };
}
