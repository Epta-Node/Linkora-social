import React, { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { WebView } from "react-native-webview";

import { createMiniAppBridge, registerPendingRequest } from "../../mini-apps/bridge";
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

export default function MiniAppHostScreen() {
  const { id, name, entry } = useLocalSearchParams<{ id: string; name: string; entry: string }>();
  const router = useRouter();
  const webviewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { apps } = useInstalledApps();
  const app = useMemo(() => apps.find((a) => a.id === id), [apps, id]);

  const bridge = useMemo(() => {
    if (!app) return null;
    return createMiniAppBridge({
      permissions: app.permissions,
      handlers: {
        "post.create": async (_payload) => {
          const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
          const promise = registerPendingRequest(requestId);
          router.push(`/mini-app/create-post?requestId=${requestId}`);
          return promise;
        },
      },
    });
  }, [app, router]);

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
        source={{ uri: entry }}
        style={styles.webview}
        onMessage={handleMessage}
        onLoadEnd={() => setLoading(false)}
        onError={(syntheticEvent) => {
          const { description } = syntheticEvent.nativeEvent;
          setLoading(false);
          setError(description);
        }}
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
          <Text style={styles.muted}>Loading {name ?? "Mini App"}...</Text>
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
