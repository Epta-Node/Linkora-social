/**
 * Resolves and validates the indexer base URL from EXPO_PUBLIC_INDEXER_URL.
 *
 * #1559 — there is intentionally no "http://localhost:3001" fallback. That
 * fallback happened to work on a simulator (which can reach the host's
 * localhost) and silently broke on a real device (localhost is the handset),
 * surfacing as a misleading "Offline mode" instead of a configuration error.
 * It also allowed cleartext HTTP in production, which iOS ATS blocks anyway
 * on device builds.
 *
 * Required: EXPO_PUBLIC_INDEXER_URL, using https://.
 * For local development against a non-TLS indexer, also set
 * EXPO_PUBLIC_LOCAL_DEV=1 to allow http://.
 */
export function getIndexerBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.EXPO_PUBLIC_INDEXER_URL;
  if (!raw) {
    throw new Error(
      "EXPO_PUBLIC_INDEXER_URL is not set. Configure it in your environment or EAS build profile " +
        "(see apps/mobile/README.md)."
    );
  }

  const allowInsecureLocal = env.EXPO_PUBLIC_LOCAL_DEV === "1";
  if (!raw.startsWith("https://") && !(allowInsecureLocal && raw.startsWith("http://"))) {
    throw new Error(
      `EXPO_PUBLIC_INDEXER_URL must use https:// (got "${raw}"). ` +
        "Set EXPO_PUBLIC_LOCAL_DEV=1 to allow http:// for local development only."
    );
  }

  return raw.replace(/\/$/, "");
}
