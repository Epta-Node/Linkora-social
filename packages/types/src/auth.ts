/**
 * Canonical message format for Stellar HTTP request authentication.
 *
 * The signed message binds a request to its method, path and body so a
 * credential captured on one endpoint cannot be replayed against another.
 * Both the indexer (verifier) and every client signer must derive the message
 * through this module so the two sides cannot drift apart.
 */

/**
 * Version prefix for the signed message. Bump this when the message layout
 * changes so the scheme can be rotated without a flag day.
 */
export const AUTH_MESSAGE_VERSION = "v1";

export interface AuthMessageParts {
  /** HTTP method. Case-insensitive — it is upper-cased into the message. */
  method: string;
  /** Request path, already normalised by {@link canonicalizeAuthPath}. */
  canonicalPath: string;
  /** Stellar public key of the signer (G...). */
  address: string;
  /** Unix epoch milliseconds at signing time. */
  timestamp: number;
  /** Lowercase hex SHA-256 of the raw request body (of "" when there is none). */
  bodyHash: string;
}

/**
 * Normalises a request path into the form that goes into the signed message.
 *
 * Drops the query string and any trailing slash, so `/api/follows?x=1` and
 * `/api/follows/` both canonicalise to `/api/follows`. The root path stays `/`.
 *
 * Signer and verifier must both call this on the same input shape — on the
 * server that input is `req.originalUrl`, which includes any mount prefix.
 */
export function canonicalizeAuthPath(rawPath: string): string {
  const withoutQuery = rawPath.split("?")[0] ?? "";
  const withoutTrailingSlash = withoutQuery.replace(/\/+$/, "");
  return withoutTrailingSlash === "" ? "/" : withoutTrailingSlash;
}

/**
 * Builds the exact string that gets SHA-256 hashed and Ed25519 signed.
 *
 * Layout: `v1:{METHOD}:{canonicalPath}:{address}:{timestamp}:{bodyHash}`
 */
export function buildAuthMessage({
  method,
  canonicalPath,
  address,
  timestamp,
  bodyHash,
}: AuthMessageParts): string {
  return [
    AUTH_MESSAGE_VERSION,
    method.toUpperCase(),
    canonicalPath,
    address,
    timestamp,
    bodyHash,
  ].join(":");
}
