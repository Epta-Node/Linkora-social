import { buildAuthMessage, canonicalizeAuthPath } from "@linkora/types/src/auth";
import { bytesToBase64, bytesToHex } from "../lib/dm/crypto";

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
        applicationServerKey: convertedKey as BufferSource,
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

export interface SignedRequestSpec {
  /** HTTP method. Case-insensitive — it is upper-cased into the signed message. */
  method: string;
  /**
   * Absolute indexer path, mount prefix included — `/api/notifications/preferences`,
   * not `/preferences`. The server canonicalises `req.originalUrl`, which always
   * carries the full path.
   */
  path: string;
  /**
   * The exact serialised string that will be sent as the request body, or
   * `undefined` when there is no body.
   *
   * This is deliberately a `string` and not an object: serialising here as well
   * as at the call site could produce two different byte sequences, and the
   * signature would then commit to a body that was never sent. Callers should
   * use {@link signedIndexerFetch}, which serialises exactly once.
   */
  body?: string;
}

/**
 * Builds an `Authorization: StellarSig …` header bound to one specific request.
 *
 * The signature covers the method, path and body hash, so a credential minted
 * for one endpoint cannot be replayed against another.
 */
export async function buildStellarAuthHeader(
  address: string,
  spec: SignedRequestSpec
): Promise<string> {
  const timestamp = Date.now();
  const bodyHash = bytesToHex(await sha256Web(new TextEncoder().encode(spec.body ?? "")));
  const message = buildAuthMessage({
    method: spec.method,
    canonicalPath: canonicalizeAuthPath(spec.path),
    address,
    timestamp,
    bodyHash,
  });
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

/**
 * Performs an authenticated request against the indexer.
 *
 * `path` is absolute from the indexer root and must include the mount prefix —
 * `/api/notifications/preferences`, never `/preferences`. The server signs over
 * `req.originalUrl`, which always carries the full path, so anything shorter
 * verifies against a different message and comes back 401. For the same reason
 * `INDEXER_URL` must be an origin only (`https://api.example.com`) with no path
 * segment of its own: a prefix baked into the origin never reaches `path`, so
 * the client would sign one path while the server canonicalises another.
 *
 * The body is serialised exactly once, and that single string is what gets
 * hashed into the signature and what gets sent — they cannot drift apart.
 */
async function signedIndexerFetch(
  address: string,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<Response> {
  const method = init.method ?? "GET";
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  const authHeader = await buildStellarAuthHeader(address, { method, path, body });

  return fetch(`${INDEXER_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      Authorization: authHeader,
    },
    body,
  });
}

export async function fetchPreferencesFromServer(address: string): Promise<any> {
  const response = await signedIndexerFetch(address, "/api/notifications/preferences");

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
  const response = await signedIndexerFetch(address, "/api/notifications/preferences", {
    method: "POST",
    body: {
      preferences,
      subscription: subscription ? subscription.toJSON() : null,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to synchronize preferences with database records.");
  }

  return await response.json();
}
