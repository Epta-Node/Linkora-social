"use client";

import React, { useRef, useEffect, useState, useId } from "react";
import { AutoResizeTextarea } from "../forms/AutoResizeTextarea";
import { CharacterCounter } from "./CharacterCounter";
import { MediaUpload } from "./MediaUpload";
import { LinkPreview } from "./LinkPreview";
import { MediaItem } from "@/hooks/useMediaUpload";
import { LinkMetadata } from "@/hooks/useLinkPreview";
import { Link as LinkIcon, Bold, Italic, Link2, Code } from "lucide-react";
import { utf8Bytes } from "linkora-sdk";

export interface PostComposerProps {
  content: string;
  onChangeContent: (value: string) => void;
  images: MediaItem[];
  onAddImages: (files: FileList | File[]) => void;
  onRemoveImage: (id: string) => void;
  isCompressing?: boolean;
  mediaError?: string | null;
  mediaLimit?: number;
  linkUrl: string;
  onChangeLinkUrl: (url: string) => void;
  linkPreview: LinkMetadata | null;
  onRemoveLinkPreview?: () => void;
  isLinkLoading?: boolean;
  characterLimit?: number;
  onLimitExceeded?: (exceeded: boolean) => void;
  onClose?: () => void;
}

// ── Markdown Sanitizer & Simple Parser ────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderMarkdownToSafeHtml(markdown: string): string {
  if (!markdown) return "";
  const escaped = escapeHtml(markdown);

  return (
    escaped
      // Bold: **text**
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      // Italic: *text* or _text_
      .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>")
      .replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<em>$1</em>")
      // Inline code: `code`
      .replace(
        /`([^`]+)`/g,
        '<code class="rounded bg-gray-100 px-1 py-0.5 text-xs font-mono text-gray-800">$1</code>'
      )
      // Markdown link: [text](url) - only http, https, mailto
      .replace(
        /\[(.+?)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline hover:text-blue-800">$1</a>'
      )
      // Newlines
      .replace(/\n/g, "<br />")
  );
}

export function PostComposer({
  content,
  onChangeContent,
  images,
  onAddImages,
  onRemoveImage,
  isCompressing = false,
  mediaError = null,
  mediaLimit,
  linkUrl,
  onChangeLinkUrl,
  linkPreview,
  onRemoveLinkPreview,
  isLinkLoading = false,
  characterLimit = 280,
  onLimitExceeded,
  onClose,
}: PostComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [activeTab, setActiveTab] = useState<"write" | "preview">("write");
  const tablistId = useId();

  useEffect(() => {
    // Focus textarea on mount when in write mode
    if (activeTab === "write") {
      textareaRef.current?.focus();
    }
  }, [activeTab]);

  useEffect(() => {
    onLimitExceeded?.(utf8Bytes(content) > characterLimit);
  }, [content, characterLimit, onLimitExceeded]);

  // Insert or wrap text syntax
  const applyFormatting = (before: string, after: string = before, defaultText = "text") => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const selectedText = content.slice(start, end) || defaultText;
    const replacement = `${before}${selectedText}${after}`;
    const newContent = content.slice(0, start) + replacement + content.slice(end);

    onChangeContent(newContent);

    // Reposition cursor and restore focus
    requestAnimationFrame(() => {
      textarea.focus();
      const newCursorStart = start + before.length;
      const newCursorEnd = newCursorStart + selectedText.length;
      textarea.setSelectionRange(newCursorStart, newCursorEnd);
    });
  };

  const handleBold = () => applyFormatting("**", "**", "bold text");
  const handleItalic = () => applyFormatting("*", "*", "italic text");
  const handleCode = () => applyFormatting("`", "`", "code");
  const handleLink = () => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? 0;
    const end = textarea?.selectionEnd ?? 0;
    const selectedText = content.slice(start, end) || "link text";
    const replacement = `[${selectedText}](https://)`;
    const newContent = content.slice(0, start) + replacement + content.slice(end);

    onChangeContent(newContent);

    requestAnimationFrame(() => {
      textarea?.focus();
      if (textarea) {
        // Position cursor inside URL parenthetical
        const urlStart = start + selectedText.length + 3;
        textarea.setSelectionRange(urlStart, urlStart + 8);
      }
    });
  };

  // Keyboard shortcut handler
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      if (onClose) {
        e.preventDefault();
        onClose();
      }
      return;
    }

    const isMod = e.ctrlKey || e.metaKey;
    if (isMod) {
      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        handleBold();
      } else if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        handleItalic();
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        handleLink();
      }
    }
  };

  return (
    <div className="space-y-4" role="region" aria-label="Post composer">
      {/* Header with Tabs & Close button */}
      <div className="flex items-center justify-between border-b border-gray-200 pb-2">
        <div
          role="tablist"
          id={tablistId}
          aria-label="Composer mode"
          className="flex items-center gap-2"
        >
          <button
            type="button"
            role="tab"
            id="composer-tab-write"
            aria-selected={activeTab === "write"}
            aria-controls="composer-tabpanel-write"
            onClick={() => setActiveTab("write")}
            className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
              activeTab === "write"
                ? "bg-gray-100 text-gray-900"
                : "text-gray-500 hover:text-gray-800"
            }`}
          >
            Write
          </button>
          <button
            type="button"
            role="tab"
            id="composer-tab-preview"
            aria-selected={activeTab === "preview"}
            aria-controls="composer-tabpanel-preview"
            onClick={() => setActiveTab("preview")}
            className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
              activeTab === "preview"
                ? "bg-gray-100 text-gray-900"
                : "text-gray-500 hover:text-gray-800"
            }`}
          >
            Preview
          </button>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close composer"
            className="text-gray-400 hover:text-gray-600 text-sm font-medium px-2 py-1 rounded"
          >
            ✕
          </button>
        )}
      </div>

      {/* Write Tab Panel */}
      {activeTab === "write" && (
        <div
          id="composer-tabpanel-write"
          role="tabpanel"
          aria-labelledby="composer-tab-write"
          className="space-y-2"
        >
          {/* Formatting Toolbar */}
          <div
            role="toolbar"
            aria-label="Text formatting tools"
            className="flex items-center gap-1 py-1 px-1 bg-gray-50 rounded-lg border border-gray-200 text-gray-600"
          >
            <button
              type="button"
              onClick={handleBold}
              aria-label="Bold (Ctrl+B)"
              title="Bold (Ctrl+B)"
              className="p-1.5 rounded hover:bg-gray-200 hover:text-gray-900 transition-colors"
            >
              <Bold className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleItalic}
              aria-label="Italic (Ctrl+I)"
              title="Italic (Ctrl+I)"
              className="p-1.5 rounded hover:bg-gray-200 hover:text-gray-900 transition-colors"
            >
              <Italic className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleLink}
              aria-label="Link (Ctrl+K)"
              title="Link (Ctrl+K)"
              className="p-1.5 rounded hover:bg-gray-200 hover:text-gray-900 transition-colors"
            >
              <Link2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleCode}
              aria-label="Code"
              title="Code"
              className="p-1.5 rounded hover:bg-gray-200 hover:text-gray-900 transition-colors"
            >
              <Code className="h-4 w-4" />
            </button>
          </div>

          {/* Text Area */}
          <div className="relative">
            <AutoResizeTextarea
              ref={textareaRef}
              value={content}
              onChange={(e) => onChangeContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What's happening?"
              aria-label="Post content"
            />
            <div className="absolute bottom-2 right-3">
              <CharacterCounter value={content} max={characterLimit} />
            </div>
          </div>
        </div>
      )}

      {/* Preview Tab Panel */}
      {activeTab === "preview" && (
        <div
          id="composer-tabpanel-preview"
          role="tabpanel"
          aria-labelledby="composer-tab-preview"
          className="min-h-[140px] p-3 rounded-lg border border-gray-200 bg-gray-50 text-gray-900 text-sm overflow-auto"
        >
          {content.trim() ? (
            <div
              className="prose prose-sm max-w-none break-words"
              dangerouslySetInnerHTML={{ __html: renderMarkdownToSafeHtml(content) }}
            />
          ) : (
            <p className="text-gray-400 italic">Nothing to preview</p>
          )}
        </div>
      )}

      {/* Image Upload Section */}
      <MediaUpload
        images={images}
        onAddImages={onAddImages}
        onRemoveImage={onRemoveImage}
        isCompressing={isCompressing}
        error={mediaError}
        maxUploadBytes={mediaLimit}
      />

      {/* Link Attachment (Plurient) Section */}
      <div className="space-y-1.5">
        <label className="text-[14px] text-gray-500 font-medium">Link</label>
        <div className="relative flex items-center">
          <div className="absolute left-3 text-gray-400 pointer-events-none">
            <LinkIcon className="h-4 w-4" />
          </div>
          <input
            type="text"
            value={linkUrl}
            onChange={(e) => onChangeLinkUrl(e.target.value)}
            placeholder="https://example.com"
            className="w-full rounded-lg border border-[#E5E7EB] bg-white pl-9 pr-4 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:border-blue-500 transition-all"
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
