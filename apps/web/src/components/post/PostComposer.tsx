"use client";

import React, { useRef, useEffect } from "react";
import { AutoResizeTextarea } from "../forms/AutoResizeTextarea";
import { CharacterCounter } from "./CharacterCounter";
import { MediaUpload } from "./MediaUpload";
import { LinkPreview } from "./LinkPreview";
import { MediaItem } from "@/hooks/useMediaUpload";
import { LinkMetadata } from "@/hooks/useLinkPreview";
import { Link as LinkIcon } from "lucide-react";

export interface PostComposerProps {
  content: string;
  onChangeContent: (value: string) => void;
  images: MediaItem[];
  onAddImages: (files: FileList | File[]) => void;
  onRemoveImage: (id: string) => void;
  isCompressing?: boolean;
  linkUrl: string;
  onChangeLinkUrl: (url: string) => void;
  linkPreview: LinkMetadata | null;
  onRemoveLinkPreview?: () => void;
  isLinkLoading?: boolean;
  characterLimit?: number;
}

export function PostComposer({
  content,
  onChangeContent,
  images,
  onAddImages,
  onRemoveImage,
  isCompressing = false,
  linkUrl,
  onChangeLinkUrl,
  linkPreview,
  onRemoveLinkPreview,
  isLinkLoading = false,
  characterLimit = 280,
}: PostComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Focus textarea on mount
    textareaRef.current?.focus();
  }, []);

  return (
    <div className="space-y-4">
      {/* Text Section */}
      <div className="space-y-1.5">
        <label className="text-[14px] text-gray-500 font-medium uppercase tracking-wide">
          Text
        </label>
        <div className="relative">
          <AutoResizeTextarea
            ref={textareaRef}
            value={content}
            onChange={(e) => onChangeContent(e.target.value)}
            placeholder="What's happening?"
            maxLength={characterLimit}
          />
          <div className="absolute bottom-2 right-3">
            <CharacterCounter current={content.length} max={characterLimit} />
          </div>
        </div>
      </div>

      {/* Image Upload Section */}
      <MediaUpload
        images={images}
        onAddImages={onAddImages}
        onRemoveImage={onRemoveImage}
        isCompressing={isCompressing}
      />

      {/* Link Attachment (Plurient) Section */}
      <div className="space-y-1.5">
        <label className="text-[14px] text-gray-500 font-medium">Plurient</label>
        <div className="relative flex items-center">
          <div className="absolute left-3 text-gray-400 pointer-events-none">
            <LinkIcon className="h-4 w-4" />
          </div>
          <input
            type="text"
            value={linkUrl}
            onChange={(e) => onChangeLinkUrl(e.target.value)}
            placeholder="Kiturioe, aol. Ilink"
            className="w-full rounded-lg border border-[#E5E7EB] bg-white pl-9 pr-4 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
          />
        </div>

        {/* Link Preview Card */}
        <LinkPreview
          metadata={linkPreview}
          onRemove={onRemoveLinkPreview}
          isLoading={isLinkLoading}
        />
      </div>
    </div>
  );
}
