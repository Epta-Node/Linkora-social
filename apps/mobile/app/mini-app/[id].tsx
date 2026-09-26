import React, { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { WebView } from "react-native-webview";

import { createMiniAppBridge, registerPendingRequest } from "../../mini-apps/bridge";
import { BridgePermission } from "../../mini-apps/permissions";
import { useInstalledApps } from "../../mini-apps/store";

const BRIDGE_INJECTION = `
(function() {
  if (window.LinkoraBridge) return;
  window.LinkoraBridge = {
    _callbacks: {},
    _nextId: 1,
    call: function(method, payload) {
      var self = this;
      var id = self._nextId++;
      return new Promise(function(resolve, reject) {
        self._callbacks[id] = { resolve: resolve, reject: reject };
        window.ReactNativeWebView.postMessage(JSON.stringify({id: id, method: method, payload: payload}));
      });
    },
    _handleResponse: function(id, error, result) {
      var self = this;
      var cb = self._callbacks[id];
      if (!cb) return;
      delete self._callbacks[id];
      if (error) cb.reject(new Error(error));
      else cb.resolve(result);
    }
  };
})();
true;
`;

/** Origin (scheme + host + port) of a URL, or null if it can't be parsed. */
export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Whether a WebView navigation request stays within the installed app's own origin. */
export function isAllowedNavigation(allowedOrigin: string | null, requestUrl: string): boolean {
  if (!allowedOrigin) return false;
  return originOf(requestUrl) === allowedOrigin;
}

export default function MiniAppHostScreen() {
  // #1551 — `entry` (and `name`) must never come from the route: a route
  // param is attacker-controlled (e.g. a `linkora://mini-app/<id>?entry=...`
  // deep link), so loading it would bind the installed app's permissions to
  // whatever page the URL happens to point at. Only `id` is taken from the
  // route; `entry`/`name` are always resolved from the installed-app record
  // below.
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const webviewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { apps } = useInstalledApps();
  const app = useMemo(() => apps.find((a) => a.id === id), [apps, id]);
  const allowedOrigin = useMemo(() => (app ? originOf(app.entry) : null), [app]);

  // #1552 — native confirmation sheet for every wallet.* and post.create
  // call, shown fresh at each call site (never cached from install time).
  // Dismissing/denying resolves false, which the bridge turns into a
  // rejected promise back to the mini app.
  const requestUserApproval = useCallback(
    (method: BridgePermission, payload?: unknown): Promise<boolean> =>
      new Promise((resolve) => {
        Alert.alert(
          "Approve action?",
          `${app?.name ?? "This mini app"} wants to call:\n${method}\n\n` +
            `Arguments:\n${JSON.stringify(payload, null, 2) ?? "(none)"}\n\n` +
            `Target: ${app?.entry ?? "unknown"}`,
          [
            { text: "Deny", style: "cancel", onPress: () => resolve(false) },
            { text: "Approve", onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) }
        );
      }),
    [app]
  );

  const bridge = useMemo(() => {
    if (!app) return null;
    return createMiniAppBridge({
      permissions: app.permissions,
      requestUserApproval,
      handlers: {
        "post.create": async (_payload) => {
          const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
          const promise = registerPendingRequest(requestId);
          router.push(`/mini-app/create-post?requestId=${requestId}`);
          return promise;
        },
      },
    });
  }, [app, router, requestUserApproval]);

  const handleMessage = useCallback(
    async (event: { nativeEvent: { data: string } }) => {
      if (!bridge) return;
      let parsed: { id: number; method: string; payload?: unknown } | null = null;
      try {
        parsed = JSON.parse(event.nativeEvent.data);
        const result = await bridge.call(parsed.method, parsed.payload);
        webviewRef.current?.injectJavaScript(
          `window.LinkoraBridge._handleResponse(${parsed.id}, null, ${JSON.stringify(result)});true;`
        );
      } catch (err) {
        const msgId = parsed?.id ?? 0;
        const message = err instanceof Error ? err.message : "Bridge call failed";
        webviewRef.current?.injectJavaScript(
          `window.LinkoraBridge._handleResponse(${msgId}, ${JSON.stringify(message)}, null);true;`
        );
      }
    },
    [bridge]
  );

  const handleReload = useCallback(() => {
    setLoading(true);
    setError(null);
    webviewRef.current?.reload();
  }, []);

  if (!app) {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Mini app not found</Text>
          <Text style={styles.errorText}>Could not find app with id "{id}".</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webviewRef}
        source={{ uri: app.entry }}
        style={styles.webview}
        onMessage={handleMessage}
        onLoadEnd={() => setLoading(false)}
        onError={(syntheticEvent) => {
          const { description } = syntheticEvent.nativeEvent;
          setLoading(false);
          setError(description);
        }}
        // #1551 — pin navigation to the installed app's own origin. Without
        // this, a page loaded from `app.entry` could navigate itself (or an
        // iframe/redirect within it) to a different origin while keeping the
        // privileged LinkoraBridge injected into it.
        onShouldStartLoadWithRequest={(request) => isAllowedNavigation(allowedOrigin, request.url)}
        injectedJavaScript={BRIDGE_INJECTION}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        renderLoading={() => (
          <View style={styles.center}>
            <ActivityIndicator color="#6366f1" />
          </View>
        )}
      />
      {error && (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorTitle}>Failed to load</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleReload}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color="#6366f1" size="large" />
          <Text style={styles.muted}>Loading {app.name}...</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  webview: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  errorOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15, 23, 42, 0.95)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  errorTitle: {
    color: "#fecaca",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 8,
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 16,
  },
  muted: {
    color: "#94a3b8",
    fontSize: 13,
    marginTop: 10,
  },
  retryButton: {
    backgroundColor: "#6366f1",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
});
