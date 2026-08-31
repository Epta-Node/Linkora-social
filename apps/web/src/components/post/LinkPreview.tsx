"use client";

import React from "react";
import { LinkMetadata } from "@/hooks/useLinkPreview";
import { ExternalLink, X } from "lucide-react";

export interface LinkPreviewProps {
  metadata: LinkMetadata | null;
  onRemove?: () => void;
  isLoading?: boolean;
}

export function LinkPreview({ metadata, onRemove, isLoading }: LinkPreviewProps) {
  if (isLoading) {
    return (
      <div className="mt-3 flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs text-gray-500 animate-pulse">
        Fetching link preview...
      </div>
    );
  }

  if (!metadata) return null;

  return (
    <div className="relative mt-3 flex flex-col rounded-lg border border-[#E5E7EB] bg-gray-50 p-3 transition-all hover:bg-gray-100/80">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 truncate">
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{metadata.siteName || metadata.url}</span>
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
        <h4 className="mt-1 text-sm font-semibold text-gray-900 line-clamp-1">{metadata.title}</h4>
      )}
      {metadata.description && (
        <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{metadata.description}</p>
      )}
    </div>
  );
}
