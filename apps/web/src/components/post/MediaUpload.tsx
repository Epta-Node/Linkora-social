"use client";

import React, { useRef } from "react";
import { MediaItem } from "@/hooks/useMediaUpload";
import { Image as ImageIcon, X, Loader2 } from "lucide-react";

export interface MediaUploadProps {
  images: MediaItem[];
  onAddImages: (files: FileList | File[]) => void;
  onRemoveImage: (id: string) => void;
  isCompressing?: boolean;
  maxCount?: number;
}

export function MediaUpload({
  images,
  onAddImages,
  onRemoveImage,
  isCompressing = false,
  maxCount = 4,
}: MediaUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onAddImages(e.target.files);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const isMaxReached = images.length >= maxCount;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[14px] text-gray-500 font-medium">Optional</label>
        <span className="text-xs text-gray-400">
          {images.length}/{maxCount}
        </span>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
      />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={isMaxReached || isCompressing}
        className="flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors cursor-pointer"
      >
        {isCompressing ? (
          <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
        ) : (
          <ImageIcon className="h-4 w-4 text-gray-500" />
        )}
        <span>Add image</span>
      </button>

      {/* Image preview grid below */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
          {images.map((img) => (
            <div
              key={img.id}
              className="group relative aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-100"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.previewUrl}
                alt="Upload preview"
                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
              />
              <button
                type="button"
                onClick={() => onRemoveImage(img.id)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black transition-colors"
                aria-label="Remove image"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
