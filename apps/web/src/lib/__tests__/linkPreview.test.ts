import {
  parseMetadata,
  shouldFetchPreview,
  createPlaceholderPreview,
  fetchLinkPreview,
} from '../linkPreview';

describe('parseMetadata', () => {
  it('should extract Open Graph metadata', () => {
    const html = `
      <html>
        <head>
          <meta property="og:title" content="Example Title" />
          <meta property="og:description" content="Example description" />
          <meta property="og:image" content="https://example.com/image.jpg" />
          <meta property="og:site_name" content="Example Site" />
          <title>Fallback Title</title>
        </head>
      </html>
    `;

    const metadata = parseMetadata(html, 'https://example.com');

    expect(metadata.title).toBe('Example Title');
    expect(metadata.description).toBe('Example description');
    expect(metadata.image).toBe('https://example.com/image.jpg');
    expect(metadata.siteName).toBe('Example Site');
  });

  it('should fall back to Twitter Card metadata', () => {
    const html = `
      <html>
        <head>
          <meta name="twitter:title" content="Twitter Title" />
          <meta name="twitter:description" content="Twitter description" />
          <meta name="twitter:image" content="https://example.com/twitter.jpg" />
        </head>
      </html>
    `;

    const metadata = parseMetadata(html, 'https://example.com');

    expect(metadata.title).toBe('Twitter Title');
    expect(metadata.description).toBe('Twitter description');
    expect(metadata.image).toBe('https://example.com/twitter.jpg');
  });

  it('should fall back to standard HTML tags', () => {
    const html = `
      <html>
        <head>
          <title>HTML Title</title>
          <meta name="description" content="HTML description" />
        </head>
      </html>
    `;

    const metadata = parseMetadata(html, 'https://example.com');

    expect(metadata.title).toBe('HTML Title');
    expect(metadata.description).toBe('HTML description');
  });

  it('should resolve relative image URLs', () => {
    const html = `
      <html>
        <head>
          <meta property="og:image" content="/images/preview.jpg" />
        </head>
      </html>
    `;

    const metadata = parseMetadata(html, 'https://example.com/page');

    expect(metadata.image).toBe('https://example.com/images/preview.jpg');
  });

  it('should return null for missing metadata', () => {
    const html = '<html><head></head><body>No metadata</body></html>';

    const metadata = parseMetadata(html, 'https://example.com');

    expect(metadata.title).toBeNull();
    expect(metadata.description).toBeNull();
    expect(metadata.image).toBeNull();
    expect(metadata.siteName).toBeNull();
  });

  it('should prioritize OG over Twitter Card', () => {
    const html = `
      <html>
        <head>
          <meta property="og:title" content="OG Title" />
          <meta name="twitter:title" content="Twitter Title" />
          <meta property="og:description" content="OG Desc" />
          <meta name="twitter:description" content="Twitter Desc" />
        </head>
      </html>
    `;

    const metadata = parseMetadata(html, 'https://example.com');

    expect(metadata.title).toBe('OG Title');
    expect(metadata.description).toBe('OG Desc');
  });
});

describe('shouldFetchPreview', () => {
  it('should allow HTTPS URLs', () => {
    expect(shouldFetchPreview('https://example.com')).toBe(true);
  });

  it('should allow HTTP URLs', () => {
    expect(shouldFetchPreview('http://example.com')).toBe(true);
  });

  it('should reject localhost', () => {
    expect(shouldFetchPreview('http://localhost:3000')).toBe(false);
    expect(shouldFetchPreview('http://127.0.0.1:8080')).toBe(false);
  });

  it('should reject private IP ranges', () => {
    expect(shouldFetchPreview('http://192.168.1.1')).toBe(false);
    expect(shouldFetchPreview('http://10.0.0.1')).toBe(false);
    expect(shouldFetchPreview('http://172.16.0.1')).toBe(false);
    expect(shouldFetchPreview('http://172.31.255.255')).toBe(false);
  });

  it('should reject non-HTTP(S) protocols', () => {
    expect(shouldFetchPreview('ftp://example.com')).toBe(false);
    expect(shouldFetchPreview('javascript:alert(1)')).toBe(false);
    expect(shouldFetchPreview('data:text/html,<h1>Test</h1>')).toBe(false);
    expect(shouldFetchPreview('file:///etc/passwd')).toBe(false);
  });

  it('should reject invalid URLs', () => {
    expect(shouldFetchPreview('not-a-url')).toBe(false);
    expect(shouldFetchPreview('')).toBe(false);
  });
});

describe('createPlaceholderPreview', () => {
  it('should create placeholder with domain as title', () => {
    const placeholder = createPlaceholderPreview('https://example.com/page');

    expect(placeholder.url).toBe('https://example.com/page');
    expect(placeholder.title).toBe('example.com');
    expect(placeholder.description).toBe('Link preview unavailable');
    expect(placeholder.image).toBeNull();
    expect(placeholder.siteName).toBeNull();
    expect(placeholder.isPlaceholder).toBe(true);
  });

  it('should handle invalid URLs gracefully', () => {
    const placeholder = createPlaceholderPreview('not-a-url');

    expect(placeholder.url).toBe('not-a-url');
    expect(placeholder.title).toBe('not-a-url');
    expect(placeholder.isPlaceholder).toBe(true);
  });
});

describe('fetchLinkPreview', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should fetch and return metadata from API', async () => {
    const mockMetadata = {
      url: 'https://example.com',
      title: 'Example Title',
      description: 'Example description',
      image: 'https://example.com/image.jpg',
      siteName: 'Example Site',
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockMetadata,
    });

    const result = await fetchLinkPreview('https://example.com');

    expect(result).toEqual(mockMetadata);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/link-preview?url=https%3A%2F%2Fexample.com'),
      expect.any(Object)
    );
  });

  it('should return placeholder for invalid URLs', async () => {
    const result = await fetchLinkPreview('javascript:alert(1)');

    expect(result.isPlaceholder).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should return placeholder when API request fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

    const result = await fetchLinkPreview('https://example.com');

    expect(result.isPlaceholder).toBe(true);
    expect(result.title).toBe('example.com');
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should return placeholder on network error', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

    const result = await fetchLinkPreview('https://example.com');

    expect(result.isPlaceholder).toBe(true);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should handle placeholder responses from API', async () => {
    const placeholderResponse = {
      url: 'https://private.example.com',
      title: 'private.example.com',
      description: 'Link preview unavailable',
      image: null,
      siteName: null,
      isPlaceholder: true,
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => placeholderResponse,
    });

    const result = await fetchLinkPreview('https://private.example.com');

    expect(result.isPlaceholder).toBe(true);
    expect(result.title).toBe('private.example.com');
  });
});
