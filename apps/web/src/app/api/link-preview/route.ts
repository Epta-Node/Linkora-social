import { NextRequest, NextResponse } from 'next/server';
import { parseMetadata, shouldFetchPreview, createPlaceholderPreview } from '@/lib/linkPreview';

// Cache previews per domain to reduce redundant fetches
const previewCache = new Map<string, { preview: any; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

/**
 * GET /api/link-preview?url=<url>
 * 
 * Server-side proxy for fetching link preview metadata.
 * Avoids CORS issues and provides caching.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json(
      { error: 'Missing url parameter' },
      { status: 400 }
    );
  }

  // Validate URL
  if (!shouldFetchPreview(url)) {
    return NextResponse.json(createPlaceholderPreview(url));
  }

  // Check cache
  const domain = new URL(url).hostname;
  const cached = previewCache.get(domain);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json(cached.preview);
  }

  try {
    // Fetch the URL with reasonable limits
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Linkora/1.0; +https://linkora.social)',
        'Accept': 'text/html',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const placeholder = createPlaceholderPreview(url);
      previewCache.set(domain, { preview: placeholder, timestamp: Date.now() });
      return NextResponse.json(placeholder);
    }

    // Check content type
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      const placeholder = createPlaceholderPreview(url);
      previewCache.set(domain, { preview: placeholder, timestamp: Date.now() });
      return NextResponse.json(placeholder);
    }

    // Limit response size to 500KB
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > 500 * 1024) {
      const placeholder = createPlaceholderPreview(url);
      previewCache.set(domain, { preview: placeholder, timestamp: Date.now() });
      return NextResponse.json(placeholder);
    }

    const html = new TextDecoder().decode(buffer);
    const metadata = parseMetadata(html, url);

    // Cache the result
    previewCache.set(domain, { preview: metadata, timestamp: Date.now() });

    return NextResponse.json(metadata);
  } catch (err) {
    console.error(`Link preview fetch error for ${url}:`, err);
    const placeholder = createPlaceholderPreview(url);
    previewCache.set(domain, { preview: placeholder, timestamp: Date.now() });
    return NextResponse.json(placeholder);
  }
}
