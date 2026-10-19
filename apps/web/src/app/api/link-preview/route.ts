import { NextRequest, NextResponse } from 'next/server';
import { parseMetadata, shouldFetchPreview, createPlaceholderPreview } from '@/lib/linkPreview';

// ---------------------------------------------------------------------------
// Bounded LRU cache — prevents unbounded memory growth (#1581)
// ---------------------------------------------------------------------------

const CACHE_TTL = 1000 * 60 * 60; // 1 hour
const CACHE_MAX = 1000;

interface CacheEntry {
  preview: ReturnType<typeof parseMetadata>;
  timestamp: number;
}

const previewCache = new Map<string, CacheEntry>();

function cacheKey(rawUrl: string): string {
  try {
    const { host, pathname, search } = new URL(rawUrl);
    return `${host}${pathname}${search}`;
  } catch {
    return rawUrl;
  }
}

function cacheGet(key: string): CacheEntry | undefined {
  const entry = previewCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp >= CACHE_TTL) {
    previewCache.delete(key);
    return undefined;
  }
  // Move to end (LRU).
  previewCache.delete(key);
  previewCache.set(key, entry);
  return entry;
}

function cacheSet(key: string, entry: CacheEntry): void {
  // Evict the oldest entry when the cap is reached.
  if (previewCache.size >= CACHE_MAX) {
    const oldest = previewCache.keys().next().value;
    if (oldest !== undefined) previewCache.delete(oldest);
  }
  previewCache.set(key, entry);
}

// ---------------------------------------------------------------------------
// Rate limiting — simple in-memory token bucket per remote IP (#1581)
// ---------------------------------------------------------------------------

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30; // requests per window per IP

const rateMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(ip);

  if (!entry || now >= entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

// ---------------------------------------------------------------------------
// Size cap via streaming — prevents buffering large responses (#1581)
// ---------------------------------------------------------------------------

const MAX_BYTES = 500 * 1024; // 500 KB

async function readBodyBounded(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal
): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) return null;

      total += value.byteLength;
      if (total > MAX_BYTES) {
        reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * GET /api/link-preview?url=<url>
 *
 * Server-side proxy for fetching link preview metadata.
 * - SSRF protection: private/loopback/link-local/IMDS addresses are blocked
 * - Redirect validation: each hop is validated before following (#1581)
 * - Streaming size cap: aborts rather than buffering huge responses (#1581)
 * - Bounded LRU cache with TTL eviction (#1581)
 * - Per-IP rate limiting (#1581)
 */
export async function GET(request: NextRequest) {
  // Rate limit by forwarded IP (or fallback to the connection address).
  const clientIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  if (isRateLimited(clientIp)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  // Validate the initial URL (SSRF check on the client-supplied address).
  if (!shouldFetchPreview(url)) {
    return NextResponse.json(createPlaceholderPreview(url));
  }

  // Cache hit.
  const key = cacheKey(url);
  const cached = cacheGet(key);
  if (cached) {
    return NextResponse.json(cached.preview);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    // Use redirect: 'manual' so we can validate every hop (#1581).
    let currentUrl = url;
    let response: Response | null = null;
    const MAX_REDIRECTS = 5;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(currentUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Linkora/1.0; +https://linkora.social)',
          Accept: 'text/html',
        },
        signal: controller.signal,
        redirect: 'manual',
      });

      // Not a redirect — this is our final response.
      if (res.status < 300 || res.status >= 400) {
        response = res;
        break;
      }

      // It is a redirect — validate the Location before following it.
      const location = res.headers.get('location');
      if (!location) {
        return NextResponse.json(createPlaceholderPreview(url));
      }

      // Resolve relative redirects.
      let nextUrl: string;
      try {
        nextUrl = new URL(location, currentUrl).href;
      } catch {
        return NextResponse.json(createPlaceholderPreview(url));
      }

      // SSRF check on the redirect target.
      if (!shouldFetchPreview(nextUrl)) {
        return NextResponse.json(createPlaceholderPreview(url));
      }

      currentUrl = nextUrl;

      if (hop === MAX_REDIRECTS) {
        // Too many redirects.
        return NextResponse.json(createPlaceholderPreview(url));
      }
    }

    if (!response) {
      return NextResponse.json(createPlaceholderPreview(url));
    }

    if (!response.ok) {
      return NextResponse.json(createPlaceholderPreview(url));
    }

    // Check content type.
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) {
      return NextResponse.json(createPlaceholderPreview(url));
    }

    // Stream the body with a hard cap — never buffer more than MAX_BYTES (#1581).
    if (!response.body) {
      return NextResponse.json(createPlaceholderPreview(url));
    }

    const bytes = await readBodyBounded(response.body, controller.signal);
    if (!bytes) {
      // Response was too large or aborted.
      return NextResponse.json(createPlaceholderPreview(url));
    }

    const html = new TextDecoder().decode(bytes);
    const metadata = parseMetadata(html, currentUrl);

    // Cache only successful metadata — never pin a placeholder.
    cacheSet(key, { preview: metadata, timestamp: Date.now() });

    return NextResponse.json(metadata);
  } catch (err) {
    console.error(`Link preview fetch error for ${url}:`, err);
    return NextResponse.json(createPlaceholderPreview(url));
  } finally {
    // Always clear the timer regardless of which exit path we took (#1581).
    clearTimeout(timeout);
  }
}
