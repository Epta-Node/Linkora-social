"use client";

import { useState, useCallback } from "react";
import { compressImage, fileToDataURL, validateImageFile } from "@/lib/media";
import { fetchUploadConfig, uploadMediaFile } from "@/lib/api";

export interface MediaItem {
  id: string;
  file: File;
  /** Local data URL used for the preview grid. */
  previewUrl: string;
  /** Public URL once the file is persisted on the server; null until then. */
  url: string | null;
  /** True while the file is being transferred to the server. */
  uploading: boolean;
  /** Per-file upload error, if any. */
  error: string | null;
}

export const MAX_MEDIA_COUNT = 4;

const DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function useMediaUpload() {
  const [images, setImages] = useState<MediaItem[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxUploadBytes, setMaxUploadBytes] = useState<number>(DEFAULT_MAX_UPLOAD_BYTES);

  const hasPendingUpload = images.some((item) => item.uploading);
  const hasFailedUpload = images.some((item) => item.error !== null);
  const hasIncompleteMedia = hasPendingUpload || hasFailedUpload;

  const addImages = useCallback(
    async (files: FileList | File[]) => {
      setError(null);
      const fileArray = Array.from(files);

      if (images.length + fileArray.length > MAX_MEDIA_COUNT) {
        setError(`You can upload a maximum of ${MAX_MEDIA_COUNT} images.`);
        return;
      }

      // The server reports the authoritative byte budget. Files at or above it
      // must be rejected before any transfer starts, since the server caps the
      // upload and would otherwise truncate or 413.
      const config = await fetchUploadConfig();
      setMaxUploadBytes(config.max_upload_bytes);

      setIsCompressing(true);
      const newItems: MediaItem[] = [];

      try {
        for (const file of fileArray) {
          const validation = validateImageFile(file, config.max_upload_bytes);
          if (!validation.valid) {
            setError(validation.error || "Invalid file.");
            continue;
          }

          const compressed = await compressImage(file);
          const previewUrl = await fileToDataURL(compressed);
          const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

          newItems.push({
            id,
            file: compressed,
            previewUrl,
            url: null,
            uploading: true,
            error: null,
          });
        }
      } catch (err) {
        console.error("Error processing image upload:", err);
        setError("Failed to process image upload.");
        setIsCompressing(false);
        return;
      }

      setIsCompressing(false);

      if (newItems.length === 0) return;

      // Add items to the list immediately (in a pending/uploading state) so the
      // composer is disabled until every file has fully uploaded or failed.
      setImages((prev) => [...prev, ...newItems]);

      // Upload each file to the server in the background.
      for (const item of newItems) {
        try {
          const result = await uploadMediaFile(item.file);
          setImages((prev) =>
            prev.map((img) =>
              img.id === item.id ? { ...img, url: result.url, uploading: false } : img
            )
          );
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "This media failed to upload. Please retry.";
          setImages((prev) =>
            prev.map((img) =>
              img.id === item.id ? { ...img, uploading: false, error: message, url: null } : img
            )
          );
          setError(message);
        }
      }
    },
    [images.length]
  );

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((item) => item.id !== id));
    setError(null);
  }, []);

  const clearImages = useCallback(() => {
    setImages([]);
    setError(null);
  }, []);

  return {
    images,
    isCompressing,
    error,
    addImages,
    removeImage,
    clearImages,
    maxCount: MAX_MEDIA_COUNT,
    maxUploadBytes,
    hasPendingUpload,
    hasFailedUpload,
    hasIncompleteMedia,
  };
}
