import { WebSocketServer } from "ws";

/**
 * Default grace period (ms) between sending the close frame and terminating
 * sockets that ignore it. Override with SHUTDOWN_WS_GRACE_MS.
 */
export const WS_CLOSE_GRACE_MS = (() => {
  const raw = process.env.SHUTDOWN_WS_GRACE_MS;
  if (!raw) return 1_000;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? 1_000 : parsed;
})();

/** Close code sent to clients when the server is shutting down (1001 Going Away). */
export const SHUTDOWN_CLOSE_CODE = 1001;

/**
 * Close a WebSocket server that still has live clients.
 *
 * `wss.close()` only stops accepting *new* connections — it never closes
 * sockets that are already established, so its callback would otherwise only
 * fire once every client disconnected on its own. That is exactly what made
 * every deploy with at least one connected client stall for the full drain
 * timeout and then exit 1.
 *
 * We instead send each client a `1001 Going Away` close frame, wait briefly
 * for the handshake, and terminate whatever is left.
 *
 * @param wss      The server to drain.
 * @param graceMs  How long to wait for close handshakes before terminating.
 * @returns A promise that resolves once every client socket is gone and the
 *          server is no longer accepting connections.
 */
export function shutdownWebSocketServer(
  wss: WebSocketServer,
  graceMs: number = WS_CLOSE_GRACE_MS
): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };

    // Tell every connected client we are going away (1001 = going away).
    for (const client of wss.clients) {
      try {
        client.close(SHUTDOWN_CLOSE_CODE, "Server shutting down");
      } catch {
        // Socket may already be closing — nothing to do.
      }
    }

    wss.close(() => {
      finish();
    });

    // Fallback for clients that ignore the close frame: terminate them once
    // the grace period elapses so `wss.close()` can never hang.
    const graceTimer = setTimeout(() => {
      for (const client of wss.clients) {
        try {
          client.terminate();
        } catch {
          // Already gone.
        }
      }
      finish();
    }, graceMs);
    graceTimer.unref();
  });
}
