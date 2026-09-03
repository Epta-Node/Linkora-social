/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react';
import { useLinkPreview, clearPreviewCache } from '../useLinkPreview';
import * as linkPreview from '@/lib/linkPreview';

jest.mock('@/lib/linkPreview');

const mockFetchLinkPreview = linkPreview.fetchLinkPreview as jest.MockedFunction<
  typeof linkPreview.fetchLinkPreview
>;

describe('useLinkPreview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearPreviewCache();
  });

  it('should fetch and return preview metadata', async () => {
    const mockMetadata: linkPreview.LinkPreviewMetadata = {
      url: 'https://example.com',
      title: 'Example Title',
      description: 'Example description',
      image: 'https://example.com/image.jpg',
      siteName: 'Example Site',
    };

    mockFetchLinkPreview.mockResolvedValue(mockMetadata);

    const { result } = renderHook(() => useLinkPreview('https://example.com'));

    // Initially loading
    expect(result.current.loading).toBe(true);
    expect(result.current.metadata).toBeNull();

    // Wait for fetch to complete
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.metadata).toEqual(mockMetadata);
    expect(result.current.error).toBeNull();
    expect(result.current.isPlaceholder).toBe(false);
  });

  it('should handle null/undefined URL', () => {
    const { result } = renderHook(() => useLinkPreview(null));

    expect(result.current.loading).toBe(false);
    expect(result.current.metadata).toBeNull();
    expect(result.current.error).toBeNull();
    expect(mockFetchLinkPreview).not.toHaveBeenCalled();
  });

  it('should detect placeholder previews', async () => {
    const placeholderMetadata: linkPreview.LinkPreviewMetadata = {
      url: 'https://example.com',
      title: 'example.com',
      description: 'Link preview unavailable',
      image: null,
      siteName: null,
      isPlaceholder: true,
    };

    mockFetchLinkPreview.mockResolvedValue(placeholderMetadata);

    const { result } = renderHook(() => useLinkPreview('https://example.com'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.metadata).toEqual(placeholderMetadata);
    expect(result.current.isPlaceholder).toBe(true);
  });

  it('should handle fetch errors', async () => {
    mockFetchLinkPreview.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useLinkPreview('https://example.com'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.metadata).toBeNull();
    expect(result.current.error).toBe('Network error');
  });

  it('should cache previews per URL', async () => {
    const mockMetadata: linkPreview.LinkPreviewMetadata = {
      url: 'https://example.com',
      title: 'Example Title',
      description: 'Example description',
      image: null,
      siteName: null,
    };

    mockFetchLinkPreview.mockResolvedValue(mockMetadata);

    // First render
    const { result: result1 } = renderHook(() => useLinkPreview('https://example.com'));

    await waitFor(() => {
      expect(result1.current.loading).toBe(false);
    });

    expect(mockFetchLinkPreview).toHaveBeenCalledTimes(1);

    // Second render with same URL
    const { result: result2 } = renderHook(() => useLinkPreview('https://example.com'));

    // Should use cache immediately
    expect(result2.current.loading).toBe(false);
    expect(result2.current.metadata).toEqual(mockMetadata);
    expect(mockFetchLinkPreview).toHaveBeenCalledTimes(1); // Still only called once
  });

  it('should refetch when URL changes', async () => {
    const metadata1: linkPreview.LinkPreviewMetadata = {
      url: 'https://example.com',
      title: 'Example 1',
      description: null,
      image: null,
      siteName: null,
    };

    const metadata2: linkPreview.LinkPreviewMetadata = {
      url: 'https://another.com',
      title: 'Example 2',
      description: null,
      image: null,
      siteName: null,
    };

    mockFetchLinkPreview
      .mockResolvedValueOnce(metadata1)
      .mockResolvedValueOnce(metadata2);

    const { result, rerender } = renderHook(
      ({ url }) => useLinkPreview(url),
      { initialProps: { url: 'https://example.com' } }
    );

    await waitFor(() => {
      expect(result.current.metadata?.title).toBe('Example 1');
    });

    // Change URL
    rerender({ url: 'https://another.com' });

    await waitFor(() => {
      expect(result.current.metadata?.title).toBe('Example 2');
    });

    expect(mockFetchLinkPreview).toHaveBeenCalledTimes(2);
  });

  it('should clear cache when clearPreviewCache is called', async () => {
    const mockMetadata: linkPreview.LinkPreviewMetadata = {
      url: 'https://example.com',
      title: 'Example Title',
      description: null,
      image: null,
      siteName: null,
    };

    mockFetchLinkPreview.mockResolvedValue(mockMetadata);

    // First render
    const { result: result1 } = renderHook(() => useLinkPreview('https://example.com'));

    await waitFor(() => {
      expect(result1.current.loading).toBe(false);
    });

    expect(mockFetchLinkPreview).toHaveBeenCalledTimes(1);

    // Clear cache
    clearPreviewCache();

    // Second render should refetch
    const { result: result2 } = renderHook(() => useLinkPreview('https://example.com'));

    await waitFor(() => {
      expect(result2.current.loading).toBe(false);
    });

    expect(mockFetchLinkPreview).toHaveBeenCalledTimes(2); // Called again
  });
});
