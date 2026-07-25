"use client";

import { useState, useCallback } from "react";
import { compressImage, fileToDataURL, validateImageFile } from "@/lib/media";

export interface MediaItem {
  id: string;
  file: File;
  previewUrl: string;
}

export const MAX_MEDIA_COUNT = 4;

export function useMediaUpload() {
  const [images, setImages] = useState<MediaItem[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addImages = useCallback(
    async (files: FileList | File[]) => {
      setError(null);
      const fileArray = Array.from(files);

      if (images.length + fileArray.length > MAX_MEDIA_COUNT) {
        setError(`You can upload a maximum of ${MAX_MEDIA_COUNT} images.`);
        return;
      }

      setIsCompressing(true);
      const newItems: MediaItem[] = [];

      try {
        for (const file of fileArray) {
          const validation = validateImageFile(file);
          if (!validation.valid) {
            setError(validation.error || "Invalid file.");
            break;
          }

          const compressed = await compressImage(file);
          const previewUrl = await fileToDataURL(compressed);
          const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

          newItems.push({
            id,
            file: compressed,
            previewUrl,
          });
        }

        if (newItems.length > 0) {
          setImages((prev) => [...prev, ...newItems]);
        }
      } catch (err) {
        console.error("Error processing image upload:", err);
        setError("Failed to process image upload.");
      } finally {
        setIsCompressing(false);
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
  };
}
