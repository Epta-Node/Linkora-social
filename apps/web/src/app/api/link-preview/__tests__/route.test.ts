/**
 * Tests for GET /api/link-preview — covers the SSRF and DoS fixes (issue #1581).
 *
 * These are unit tests that mock `fetch`; they do not require a running server.
 */
import { NextRequest } from 'next/server';

// The module is imported after mocking fetch so we get a fresh module state.
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Import after setting up the mock so the module-level cache starts empty.
// jest.resetModules() is used per-describe block to clear the LRU cache state.
let GET: (req: NextRequest) => Promise<Response>;

beforeAll(async () => {
  jest.resetModules();
  ({ GET } = await import('../route'));
});

afterEach(() => {
  mockFetch.mockReset();
});

function makeRequest(url: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/link-preview?url=${encodeURIComponent(url)}`,
    { headers: { 'x-forwarded-for': '1.2.3.4' } }
  );
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function redirectResponse(location: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: { location },
  });
}

describe('GET /api/link-preview', () => {
  it('returns placeholder immediately for a private IP without fetching', async () => {
    const req = makeRequest('http://169.254.169.254/latest/meta-data/');
    const res = await GET(req);
    const body = await res.json();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(body.isPlaceholder).toBe(true);
  });

  it('returns placeholder immediately for 0.0.0.0 without fetching', async () => {
    const req = makeRequest('http://0.0.0.0/');
    const res = await GET(req);
    const body = await res.json();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(body.isPlaceholder).toBe(true);
  });

  it('blocks a redirect that points to an internal address (SSRF via redirect)', async () => {
    // First hop is a valid public URL; the redirect goes to IMDS.
    mockFetch.mockResolvedValueOnce(redirectResponse('http://169.254.169.254/latest/meta-data/'));

    const req = makeRequest('https://public-site.example.com/redirect-me');
    const res = await GET(req);
    const body = await res.json();

    expect(body.isPlaceholder).toBe(true);
    // Only one fetch call — we did NOT follow the redirect to the internal address.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('follows a safe redirect and returns metadata', async () => {
    const html = `<html><head><title>Safe Page</title></head></html>`;
    mockFetch
      .mockResolvedValueOnce(redirectResponse('https://safe-target.example.com/'))
      .mockResolvedValueOnce(htmlResponse(html));

    const req = makeRequest('https://safe-source.example.com/');
    const res = await GET(req);
    const body = await res.json();

    expect(body.isPlaceholder).toBeUndefined();
    expect(body.title).toBe('Safe Page');
  });

  it('returns placeholder when the response body exceeds the size cap', async () => {
    // Create a stream that produces MAX_BYTES + 1 bytes.
    const bigChunk = new Uint8Array(500 * 1024 + 1).fill(65); // 'A'
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bigChunk);
        controller.close();
      },
    });
    mockFetch.mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    );

    const req = makeRequest('https://huge-page.example.com/');
    const res = await GET(req);
    const body = await res.json();

    expect(body.isPlaceholder).toBe(true);
  });

  it('returns metadata for a normal successful fetch', async () => {
    const html = `<html><head>
      <meta property="og:title" content="My Title" />
      <meta property="og:description" content="My description" />
    </head></html>`;

    mockFetch.mockResolvedValueOnce(htmlResponse(html));

    const req = makeRequest('https://example.com/article');
    const res = await GET(req);
    const body = await res.json();

    expect(body.title).toBe('My Title');
    expect(body.description).toBe('My description');
    expect(body.isPlaceholder).toBeUndefined();
  });

  it('returns 400 when the url parameter is missing', async () => {
    const req = new NextRequest('http://localhost/api/link-preview', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
});
