"use client";

import { useState, useCallback } from "react";

export interface LinkMetadata {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  isPlaceholder?: boolean;
}

const CACHE_KEY_PREFIX = "linkpreview_cache_";
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

const URL_REGEX = /(https?:\/\/[^\s]+)/gi;

export function extractFirstUrl(text: string): string | null {
  const match = text.match(URL_REGEX);
  return match && match[0] ? match[0] : null;
}

function getCacheKey(url: string): string {
  return `${CACHE_KEY_PREFIX}${url}`;
}

function getCachedMetadata(url: string): LinkMetadata | null {
  try {
    const cached = localStorage.getItem(getCacheKey(url));
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    if (parsed.expiry && parsed.expiry < Date.now()) {
      localStorage.removeItem(getCacheKey(url));
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function setCachedMetadata(url: string, metadata: LinkMetadata): void {
  try {
    localStorage.setItem(
      getCacheKey(url),
      JSON.stringify({
        data: metadata,
        expiry: Date.now() + CACHE_DURATION_MS,
      })
    );
  } catch {
    // Ignore cache write failures
  }
}

export function useLinkPreview(initialUrl: string = "") {
  const [url, setUrl] = useState<string>(initialUrl);
  const [linkPreview, setLinkPreview] = useState<LinkMetadata | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMetadata = useCallback(async (targetUrl: string) => {
    if (!targetUrl) return;

    // Check cache first
    const cached = getCachedMetadata(targetUrl);
    if (cached) {
      setLinkPreview(cached);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Clean target url
      const formattedUrl = targetUrl.startsWith("http") ? targetUrl : `https://${targetUrl}`;
      const domain = new URL(formattedUrl).hostname.replace(/^www\./, "");

      // Provide metadata with fallback title/domain
      const metadata: LinkMetadata = {
        url: formattedUrl,
        title: domain,
        description: `Link attachment preview for ${domain}`,
        siteName: domain,
      };

      setLinkPreview(metadata);
      setCachedMetadata(formattedUrl, metadata);
    } catch {
      setError("Invalid URL format");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const detectAndFetchLink = useCallback(
    (text: string) => {
      const detected = extractFirstUrl(text);
      if (detected && detected !== url) {
        setUrl(detected);
        fetchMetadata(detected);
      }
    },
    [url, fetchMetadata]
  );

  const setManualUrl = useCallback(
    (inputUrl: string) => {
      setUrl(inputUrl);
      if (inputUrl.trim()) {
        fetchMetadata(inputUrl);
      } else {
        setLinkPreview(null);
      }
    },
    [fetchMetadata]
  );

  const clearLinkPreview = useCallback(() => {
    setUrl("");
    setLinkPreview(null);
    setError(null);
  }, []);

  return {
    url,
    linkPreview,
    isLoading,
    error,
    detectAndFetchLink,
    setManualUrl,
    clearLinkPreview,
  };
}
