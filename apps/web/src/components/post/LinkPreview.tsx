"use client";

import React from "react";
import { LinkMetadata } from "@/hooks/useLinkPreview";
import { ExternalLink, X } from "lucide-react";

export interface LinkPreviewProps {
  metadata: LinkMetadata | null;
  onRemove?: () => void;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

export function LinkPreview({ metadata, onRemove, isLoading, isError, onRetry }: LinkPreviewProps) {
  if (isLoading) {
    return (
      <div className="mt-3 flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs text-gray-500 animate-pulse">
        Fetching link preview...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mt-3 flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
        <div className="flex-1">
          <p className="text-xs font-semibold text-red-600">Failed to load preview</p>
          <p className="text-xs text-red-500 mt-0.5">The link preview could not be fetched. You can still share the link.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded px-2 py-1 text-xs font-semibold bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
              aria-label="Retry loading link preview"
            >
              Retry
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="rounded p-1 text-gray-400 hover:bg-red-100 hover:text-gray-600 transition-colors"
              aria-label="Remove link"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!metadata) return null;

  const isPlaceholder = metadata.isPlaceholder === true;

  return (
    <div className={`relative mt-3 flex flex-col rounded-lg border transition-all p-3 ${
      isPlaceholder
        ? "border-gray-300 bg-gray-100 hover:bg-gray-100/80"
        : "border-[#E5E7EB] bg-gray-50 hover:bg-gray-100/80"
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold truncate">
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          <span className={`truncate ${isPlaceholder ? "text-gray-600" : "text-blue-600"}`}>
            {metadata.siteName || metadata.url}
          </span>
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-full p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-colors"
            aria-label="Remove link preview"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {metadata.title && (
        <h4 className={`mt-1 text-sm font-semibold line-clamp-1 ${
          isPlaceholder ? "text-gray-700" : "text-gray-900"
        }`}>
          {metadata.title}
        </h4>
      )}
      {metadata.description && (
        <p className={`mt-0.5 text-xs line-clamp-2 ${
          isPlaceholder ? "text-gray-600" : "text-gray-500"
        }`}>
          {metadata.description}
        </p>
      )}
      {isPlaceholder && (
        <p className="mt-1 text-xs text-gray-500 italic">
          Full preview unavailable, but the link is valid
        </p>
      )}
    </div>
  );
}
