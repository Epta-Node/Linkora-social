import { deleteCustomIndexerUrl, getCustomIndexerUrl, setCustomIndexerUrl } from "./secureStorage";

/**
 * Validates and normalizes an indexer URL. Requires https:// unless
 * EXPO_PUBLIC_LOCAL_DEV=1 is set for local development.
 */
export function validateIndexerUrl(
  raw: string,
  env: Record<string, string | undefined> = process.env
): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Indexer URL cannot be empty.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid indexer URL format: "${trimmed}".`);
  }

  const allowInsecureLocal = env.EXPO_PUBLIC_LOCAL_DEV === "1";
  const protocolOk =
    parsed.protocol === "https:" || (allowInsecureLocal && parsed.protocol === "http:");
  if (!protocolOk) {
    throw new Error(
      `Indexer URL must use https:// (got "${trimmed}"). ` +
        "Set EXPO_PUBLIC_LOCAL_DEV=1 to allow http:// for local development only."
    );
  }

  return trimmed.replace(/\/+$/, "");
}

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

export async function saveCustomIndexerUrl(
  raw: string,
  env: Record<string, string | undefined> = process.env
): Promise<string> {
  const normalized = validateIndexerUrl(raw, env);
  await setCustomIndexerUrl(normalized);
  return normalized;
}

export async function loadCustomIndexerUrl(): Promise<string | null> {
  return getCustomIndexerUrl();
}

export async function clearCustomIndexerUrl(): Promise<void> {
  await deleteCustomIndexerUrl();
}

export async function resolveIndexerBaseUrl(
  env: Record<string, string | undefined> = process.env
): Promise<string> {
  const custom = await getCustomIndexerUrl();
  if (custom) {
    return validateIndexerUrl(custom, env);
  }
  return getIndexerBaseUrl(env);
}
