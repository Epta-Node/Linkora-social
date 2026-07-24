"use client";

import { useState, useCallback } from "react";

export interface LinkMetadata {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

const URL_REGEX = /(https?:\/\/[^\s]+)/gi;

export function extractFirstUrl(text: string): string | null {
  const match = text.match(URL_REGEX);
  return match && match[0] ? match[0] : null;
}

export function useLinkPreview(initialUrl: string = "") {
  const [url, setUrl] = useState<string>(initialUrl);
  const [linkPreview, setLinkPreview] = useState<LinkMetadata | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMetadata = useCallback(async (targetUrl: string) => {
    if (!targetUrl) return;
    setIsLoading(true);
    setError(null);

    try {
      // Clean target url
      const formattedUrl = targetUrl.startsWith("http") ? targetUrl : `https://${targetUrl}`;
      const domain = new URL(formattedUrl).hostname.replace(/^www\./, "");

      // Provide metadata with fallback title/domain
      setLinkPreview({
        url: formattedUrl,
        title: domain,
        description: `Link attachment preview for ${domain}`,
        siteName: domain,
      });
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
