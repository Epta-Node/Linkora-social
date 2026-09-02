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
 * Check if a URL should be fetched for preview.
 * Reject non-HTTP(S) schemes and known problematic patterns.
 */
export function shouldFetchPreview(url: string): boolean {
  try {
    const parsed = new URL(url);
    
    // Only HTTP/HTTPS
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    // Skip localhost and private IPs
    if (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname.startsWith('192.168.') ||
      parsed.hostname.startsWith('10.') ||
      parsed.hostname.match(/^172\.(1[6-9]|2[0-9]|3[01])\./)
    ) {
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
