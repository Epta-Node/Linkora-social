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
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const STELLAR_PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function getDeepLinkSegments(value: string): Array<string | null> | null {
  const trimmed = value.trim();

  if (trimmed.startsWith(LINKORA_PREFIX)) {
    const withoutScheme = trimmed.slice(LINKORA_PREFIX.length);
    const pathEndIndex = withoutScheme.search(/[?#]/);
    const rawPath = pathEndIndex === -1 ? withoutScheme : withoutScheme.slice(0, pathEndIndex);
    const path = rawPath.startsWith("/") ? rawPath.slice(1) : rawPath;
    const segments = path.split("/").filter(Boolean);

    if (segments.length !== 2) {
      return null;
    }

    return segments.map(safeDecode);
  }

  for (const prefix of UNIVERSAL_LINK_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      const withoutPrefix = trimmed.slice(prefix.length);
      const pathEndIndex = withoutPrefix.search(/[?#]/);
      const rawPath = pathEndIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, pathEndIndex);
      const path = rawPath.startsWith("/") ? rawPath.slice(1) : rawPath;
      const segments = path.split("/").filter(Boolean);

      if (segments.length !== 2) {
        return null;
      }

      return segments.map(safeDecode);
    }
  }

  return null;
}

function isValidId(value: string): boolean {
  return ID_PATTERN.test(value);
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

export function isValidDeepLink(value: string): boolean {
  return parseDeepLink(value) !== null;
}
