/**
 * Link Preview Metadata Parser
 * 
 * Fetches and parses Open Graph and Twitter Card metadata from URLs.
 * Falls back gracefully when metadata is unavailable or parsing fails.
 */

export interface LinkPreviewMetadata {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  /** Indicates this is a placeholder due to fetch/parse failure */
  isPlaceholder?: boolean;
}

/**
 * Parse HTML to extract Open Graph and Twitter Card metadata.
 * 
 * Priority order:
 * 1. Open Graph tags (og:*)
 * 2. Twitter Card tags (twitter:*)
 * 3. Standard HTML meta tags
 * 4. <title> element
 */
export function parseMetadata(html: string, url: string): LinkPreviewMetadata {
  const metadata: LinkPreviewMetadata = {
    url,
    title: null,
    description: null,
    image: null,
    siteName: null,
  };

  // Extract title: og:title > twitter:title > <title>
  const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  const twitterTitle = html.match(/<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i);
  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  metadata.title = ogTitle?.[1] || twitterTitle?.[1] || titleTag?.[1] || null;

  // Extract description: og:description > twitter:description > meta description
  const ogDesc = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  const twitterDesc = html.match(/<meta[^>]*name=["']twitter:description["'][^>]*content=["']([^"']+)["']/i);
  const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  metadata.description = ogDesc?.[1] || twitterDesc?.[1] || metaDesc?.[1] || null;

  // Extract image: og:image > twitter:image
  const ogImage = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  const twitterImage = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
  let imageUrl = ogImage?.[1] || twitterImage?.[1] || null;

  // Resolve relative image URLs
  if (imageUrl && !imageUrl.startsWith('http')) {
    try {
      const baseUrl = new URL(url);
      imageUrl = new URL(imageUrl, baseUrl.origin).href;
    } catch {
      imageUrl = null;
    }
  }
  metadata.image = imageUrl;

  // Extract site name: og:site_name
  const ogSiteName = html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i);
  metadata.siteName = ogSiteName?.[1] || null;

  return metadata;
}

/**
 * Normalise an IPv4 literal to dotted-decimal, handling:
 *  - decimal (normal)    http://2130706433/  → 127.0.0.1
 *  - octal per-octet     http://0177.0.0.01/ → 127.0.0.1
 *  - hex per-octet       http://0x7f.0.0.1/  → 127.0.0.1
 *  - mixed               http://0x7f000001/  → 127.0.0.1
 *
 * Returns null when the string is not an IPv4 literal so callers can fall
 * through to hostname checks.
 */
function normaliseIPv4(hostname: string): string | null {
  // Strip a trailing dot (DNS FQDN form).
  const h = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;

  // Hex/octal/decimal packed 32-bit integer: 0x7f000001, 2130706433, 017700000001
  if (/^(0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(h)) {
    let n: number;
    try {
      n = Number(h); // JS Number() handles 0x…, 0… (octal only for parseInt)
      if (h.startsWith('0') && !h.startsWith('0x')) {
        n = parseInt(h, 8);
      }
    } catch {
      return null;
    }
    if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
    return [
      (n >>> 24) & 0xff,
      (n >>> 16) & 0xff,
      (n >>> 8) & 0xff,
      n & 0xff,
    ].join('.');
  }

  // Dotted notation with 1–4 parts, each in any base.
  const parts = h.split('.');
  if (parts.length < 1 || parts.length > 4) return null;
  if (!parts.every((p) => /^(0x[0-9a-f]+|0[0-7]*|\d+)$/i.test(p))) return null;

  const octets: number[] = parts.map((p) => {
    if (p.startsWith('0x') || p.startsWith('0X')) return parseInt(p, 16);
    if (p.startsWith('0') && p.length > 1) return parseInt(p, 8);
    return parseInt(p, 10);
  });

  if (octets.some((o) => !Number.isFinite(o) || o < 0 || o > 255)) return null;

  // Pad short forms: 127.1 → 127.0.0.1
  while (octets.length < 4) octets.splice(octets.length - 1, 0, 0);

  return octets.join('.');
}

/**
 * Returns true when the dotted-decimal IPv4 address falls in a private,
 * loopback, link-local, or otherwise non-routable range.
 */
function isPrivateIPv4(dotted: string): boolean {
  const parts = dotted.split('.').map(Number);
  const [a, b] = parts;

  if (a === undefined || b === undefined) return false;

  return (
    a === 0 ||                              // 0.0.0.0/8 — "this host"
    a === 10 ||                             // 10.0.0.0/8 — RFC1918
    a === 127 ||                            // 127.0.0.0/8 — loopback
    a === 169 && b === 254 ||               // 169.254.0.0/16 — link-local / IMDS
    a === 172 && b >= 16 && b <= 31 ||      // 172.16.0.0/12 — RFC1918
    a === 192 && b === 168 ||               // 192.168.0.0/16 — RFC1918
    a === 198 && (b === 18 || b === 19) ||  // 198.18.0.0/15 — benchmarking
    a === 203 && b === 0 && parts[2] === 113 || // 203.0.113.0/24 — documentation
    a === 100 && b >= 64 && b <= 127 ||     // 100.64.0.0/10 — shared address (CGNAT)
    a === 192 && b === 0 && parts[2] === 0 || // 192.0.0.0/24 — IETF protocol assignments
    a === 192 && b === 0 && parts[2] === 2 || // 192.0.2.0/24 — documentation
    a === 198 && b === 51 && parts[2] === 100 || // 198.51.100.0/24 — documentation
    a === 233 && b === 252 && parts[2] === 0 || // 233.252.0.0/24 — documentation
    a >= 224 ||                             // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
    dotted === '255.255.255.255'
  );
}

/**
 * Returns true when a hostname is a private/loopback/reserved address in any
 * of the forms that URL parsers accept (decimal, octal, hex, IPv6 loopback,
 * unique-local, link-local).
 */
function isPrivateHost(hostname: string): boolean {
  // Explicit rejections that don't need normalisation.
  if (hostname === 'localhost' || hostname === '0.0.0.0') return true;

  // IPv6: strip brackets added by URL parser.
  const ipv6 = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;

  if (ipv6 === '::1' || ipv6 === '::' || ipv6 === '0:0:0:0:0:0:0:1') return true;
  if (
    ipv6.toLowerCase().startsWith('fc') ||   // fc00::/7 — unique-local
    ipv6.toLowerCase().startsWith('fd') ||   // fc00::/7 — unique-local
    ipv6.toLowerCase().startsWith('fe80')    // fe80::/10 — link-local
  ) return true;

  // Try to normalise as IPv4 (handles decimal/octal/hex/packed forms).
  const normalised = normaliseIPv4(hostname);
  if (normalised !== null) {
    return isPrivateIPv4(normalised);
  }

  return false;
}

/**
 * Check if a URL should be fetched for preview.
 * Reject non-HTTP(S) schemes and private/internal hosts (SSRF protection).
 */
export function shouldFetchPreview(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Only HTTP/HTTPS
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    if (isPrivateHost(parsed.hostname)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Create a neutral placeholder preview for failed/unparseable URLs.
 */
export function createPlaceholderPreview(url: string): LinkPreviewMetadata {
  let domain = url;
  try {
    domain = new URL(url).hostname;
  } catch {
    // Keep full URL if parsing fails
  }

  return {
    url,
    title: domain,
    description: "Link preview unavailable",
    image: null,
    siteName: null,
    isPlaceholder: true,
  };
}

/**
 * Fetch and parse link preview metadata from a URL.
 * Uses a server-side API route to avoid CORS issues.
 * 
 * @param url - The URL to fetch preview for
 * @param apiEndpoint - The API route that proxies the fetch (default: /api/link-preview)
 * @returns Preview metadata or placeholder on failure
 */
export async function fetchLinkPreview(
  url: string,
  apiEndpoint = '/api/link-preview'
): Promise<LinkPreviewMetadata> {
  // Validate URL
  if (!shouldFetchPreview(url)) {
    return createPlaceholderPreview(url);
  }

  try {
    const response = await fetch(`${apiEndpoint}?url=${encodeURIComponent(url)}`, {
      headers: {
        'Accept': 'application/json',
      },
      // 10 second timeout
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn(`Link preview fetch failed: ${response.status} ${response.statusText}`);
      return createPlaceholderPreview(url);
    }

    const data = await response.json();
    
    // Validate response structure
    if (data.isPlaceholder) {
      return data as LinkPreviewMetadata;
    }

    return {
      url: data.url || url,
      title: data.title || null,
      description: data.description || null,
      image: data.image || null,
      siteName: data.siteName || null,
    };
  } catch (err) {
    console.warn(`Link preview error for ${url}:`, err);
    return createPlaceholderPreview(url);
  }
}
