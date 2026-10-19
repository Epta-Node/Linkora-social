export type DeepLinkRoute =
  | {
      type: "post";
      path: `/post/${string}`;
    }
  | {
      type: "profile";
      path: `/profile/${string}`;
    }
  | {
      type: "pool";
      path: `/pools/${string}`;
    }
  | {
      type: "dm";
      path: `/dm/${string}`;
    };

const LINKORA_SCHEME = "linkora:";
const LINKORA_PREFIX = "linkora://";
const UNIVERSAL_LINK_PREFIXES = ["https://linkora.social/", "https://www.linkora.social/"];
// #1555 — the identifier segment is a single, opaque token: letters, digits,
// `_` and `-` only. `.`, `/`, `?` and `#` are excluded by construction, so a
// crafted payload can never smuggle a path traversal, a query string or a
// fragment into the router through the identifier.
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const STELLAR_PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;
// Reject `.` and `..` outright even though ID_PATTERN already excludes them:
// this is a navigable target, and a segment that means "the parent directory"
// should never be treated as an identifier anywhere in this module.
const RESERVED_PATH_SEGMENTS: ReadonlySet<string> = new Set([".", ".."]);

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Splits a link into exactly two segments, or null.
 *
 * #1555 — a query string or fragment means the payload is not a bare route
 * identifier, so it is rejected outright rather than truncated at the `?`.
 * Previously `linkora://post/x?a=b` navigated to `/post/x` and ignored the
 * rest, and the same data took different rules depending on which entry point
 * handled it. One parser, one rule.
 */
function getDeepLinkSegments(value: string): Array<string | null> | null {
  const trimmed = value.trim();
  const prefix = getSupportedPrefix(trimmed);

  if (!prefix) {
    return null;
  }

  const withoutPrefix = trimmed.slice(prefix.length);

  if (withoutPrefix.includes("?") || withoutPrefix.includes("#")) {
    return null;
  }

  const path = withoutPrefix.startsWith("/") ? withoutPrefix.slice(1) : withoutPrefix;
  const segments = path.split("/").filter(Boolean);

  if (segments.length !== 2) {
    return null;
  }

  return segments.map(safeDecode);
}

function getSupportedPrefix(value: string): string | null {
  if (value.startsWith(LINKORA_PREFIX)) {
    return LINKORA_PREFIX;
  }

  for (const prefix of UNIVERSAL_LINK_PREFIXES) {
    if (value.startsWith(prefix)) {
      return prefix;
    }
  }

  return null;
}

function isValidId(value: string): boolean {
  return !RESERVED_PATH_SEGMENTS.has(value) && ID_PATTERN.test(value);
}

function isValidProfileAddress(value: string): boolean {
  return STELLAR_PUBLIC_KEY_PATTERN.test(value);
}

export function parseDeepLink(value: string): DeepLinkRoute | null {
  if (!value.startsWith(LINKORA_SCHEME) && !value.startsWith("https://")) {
    return null;
  }

  const segments = getDeepLinkSegments(value);

  if (!segments || segments.some((segment) => !segment)) {
    return null;
  }

  const [resource, rawId] = segments as [string, string];

  switch (resource) {
    case "post":
      return isValidId(rawId) ? { type: "post", path: `/post/${rawId}` } : null;
    case "profile":
      return isValidProfileAddress(rawId) ? { type: "profile", path: `/profile/${rawId}` } : null;
    case "pool":
      return isValidId(rawId) ? { type: "pool", path: `/pools/${rawId}` } : null;
    case "dm":
      return isValidProfileAddress(rawId) ? { type: "dm", path: `/dm/${rawId}` } : null;
    default:
      return null;
  }
}

/**
 * In-app route prefix -> deep-link resource. The router's `pools` screen is
 * addressed as the `pool` resource in a `linkora://` link, so a bare path is
 * translated before validation rather than being parsed with a second,
 * drifting rule set.
 */
const ROUTE_PREFIX_TO_RESOURCE: Readonly<Record<string, string>> = {
  post: "post",
  profile: "profile",
  pools: "pool",
  dm: "dm",
};

/**
 * Validates an in-app route path (`/pools/123`) through the exact same parser
 * as an external deep link.
 *
 * #1555 — notification payloads and typed fallbacks carry bare paths. Rather
 * than matching them against a hand-maintained prefix allowlist and pushing
 * them straight into the router, they are normalised to a `linkora://` URL and
 * handed to `parseDeepLink`, so an unparsable, traversing or query-bearing
 * value is rejected instead of navigated to. There is one set of rules for
 * every entry point.
 */
export function parseRoutePath(value: string): DeepLinkRoute | null {
  const trimmed = value.trim();

  if (!trimmed.startsWith("/")) {
    return null;
  }

  const [prefix, ...rest] = trimmed.slice(1).split("/");
  const resource = ROUTE_PREFIX_TO_RESOURCE[prefix];

  if (!resource || rest.length !== 1) {
    return null;
  }

  return parseDeepLink(`${LINKORA_PREFIX}${resource}/${rest[0]}`);
}

export function isValidDeepLink(value: string): boolean {
  return parseDeepLink(value) !== null;
}
