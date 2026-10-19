import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { parseDeepLink, parseRoutePath } from "../utils/deepLinks";

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

// #1556 — set as soon as either entry point handles a response, so the cold
// start read and the live listener can never both navigate for one tap. Module
// scoped rather than per-hook so a re-render (or a second call to
// setupNotificationListeners) can't reset the guard mid-flight.
let handledResponseRef = false;

/** Test-only: reset the once-only navigation guard between cases. */
export function __resetNotificationResponseGuard(): void {
  handledResponseRef = false;
}

/**
 * #1555 — the sole navigation entry point for notification payloads. Every
 * target, whether it arrived as a `linkora://` link, an `https://` universal
 * link or a bare in-app path, is resolved by the same parser. The prefix
 * allowlist that used to short-circuit straight into `router.push` is gone: it
 * pushed the raw string, so a crafted identifier carrying `..`, a query string
 * or an encoded `/` reached the router unparsed, and it applied different rules
 * to the same data than the deep-link entry point did.
 */
function navigateToDeepLink(value?: string): boolean {
  if (!value) {
    return false;
  }

  const parsed = parseDeepLink(value) ?? parseRoutePath(value);

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
 *
 * #1555 — the target is validated by `navigateToDeepLink` like any other, so a
 * payload whose `postId`/`poolId`/`followerAddress` is not a well-formed
 * identifier is rejected rather than routed to.
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
  if (fallback && navigateToDeepLink(fallback)) {
    return;
  }

  router.push(FALLBACK_ROUTE as Parameters<typeof router.push>[0]);
}

/**
 * #1556 — the single handler behind both entry points: a warm tap (live
 * listener) and a cold start (the response that terminated the app). Sharing it
 * means the two paths can never drift, and the once-only guard means a cold
 * start that also fires the live listener navigates a single time.
 */
function handleNotificationResponse(response: Notifications.NotificationResponse | null): void {
  if (!response) {
    return;
  }

  const data = response.notification.request.content.data as unknown as NotificationPayload;

  if (!data || !data.type) {
    router.push(FALLBACK_ROUTE as Parameters<typeof router.push>[0]);
    return;
  }

  navigateForNotification(data);
}

/**
 * #1556 — routes a response through the shared handler at most once per app
 * session. Whichever entry point wins the race marks the response handled, so
 * the other one becomes a no-op instead of navigating the user twice.
 */
function handleResponseOnce(response: Notifications.NotificationResponse | null): boolean {
  if (!response || handledResponseRef) {
    return false;
  }

  handledResponseRef = true;
  handleNotificationResponse(response);
  return true;
}

export function setupNotificationListeners() {
  // Listener for foreground notifications
  const notificationListener = Notifications.addNotificationReceivedListener((notification) => {
    console.log("Notification received in foreground:", notification);
  });

  // Listener for notification taps (when user interacts with a notification)
  const responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
    console.log(
      "Notification response (tap) received:",
      response.notification.request.content.data
    );
    handleResponseOnce(response);
  });

  // #1556 — cold start. When the user taps a notification while the app is not
  // running, the response that launched the app is never delivered to the live
  // listener, so without this read the tap is silently discarded and the app
  // opens on the default route. Without the ref guard the same response would
  // also reach the live listener and navigate twice.
  void (async () => {
    let response: Notifications.NotificationResponse | null = null;
    try {
      response = await Notifications.getLastNotificationResponseAsync();
    } catch {
      return;
    }

    if (!handleResponseOnce(response)) {
      return;
    }

    // Drop it so a later relaunch does not re-navigate to the same screen.
    try {
      await Notifications.clearLastNotificationResponseAsync();
    } catch {
      // Best-effort: navigation already happened, and the guard blocks re-entry.
    }
  })();

  return () => {
    notificationListener.remove();
    responseListener.remove();
  };
}
