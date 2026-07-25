"use client";

import React, { useState, useEffect, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2 } from "lucide-react";
import { PostComposer } from "../post/PostComposer";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { useLinkPreview } from "@/hooks/useLinkPreview";
import { useDraft } from "@/hooks/useDraft";

export interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit?: (data: {
    content: string;
    images: string[];
    linkUrl?: string;
  }) => Promise<void> | void;
  author?: string;
}

export function CreatePostModal({ isOpen, onClose, onSubmit, author }: CreatePostModalProps) {
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { images, addImages, removeImage, clearImages, isCompressing } = useMediaUpload();
  const {
    url: linkUrl,
    linkPreview,
    setManualUrl,
    detectAndFetchLink,
    clearLinkPreview,
    isLoading: isLinkLoading,
  } = useLinkPreview();
  const { draft, saveDraft, clearDraft } = useDraft();

  // Load draft if available when opening modal
  useEffect(() => {
    if (isOpen && draft) {
      if (draft.content && !content) {
        setContent(draft.content);
      }
      if (draft.linkUrl && !linkUrl) {
        setManualUrl(draft.linkUrl);
      }
    }
  }, [isOpen, draft]);

  // Handle content change & trigger url detection + draft save
  const handleContentChange = (value: string) => {
    setContent(value);
    detectAndFetchLink(value);
    saveDraft(value, linkUrl);
  };

  const handleLinkUrlChange = (value: string) => {
    setManualUrl(value);
    saveDraft(content, value);
  };

  const handleSubmit = useCallback(async () => {
    if ((!content.trim() && images.length === 0) || isSubmitting) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const imageUrls = images.map((img) => img.previewUrl);
      if (onSubmit) {
        await onSubmit({
          content,
          images: imageUrls,
          linkUrl: linkUrl || undefined,
        });
      }

      // Reset state & clear saved draft
      setContent("");
      clearImages();
      clearLinkPreview();
      clearDraft();
      onClose();
    } catch (err) {
      console.error("Failed to submit post:", err);
      setSubmitError("Failed to publish post. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [
    content,
    images,
    linkUrl,
    isSubmitting,
    onSubmit,
    clearImages,
    clearLinkPreview,
    clearDraft,
    onClose,
  ]);

  // Keyboard shortcut: Cmd+Enter or Ctrl+Enter to submit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isOpen && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleSubmit]);

  const isPostDisabled = (!content.trim() && images.length === 0) || isSubmitting || isCompressing;

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AnimatePresence>
        {isOpen && (
          <Dialog.Portal forceMount>
            {/* Backdrop */}
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
                style={{
                  backgroundColor: "rgba(0,0,0,0.5)",
                  backdropFilter: "blur(4px)",
                }}
              />
            </Dialog.Overlay>

            {/* Modal Dialog Content */}
            <Dialog.Content asChild>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="fixed left-1/2 top-1/2 z-50 w-full max-w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-[16px] bg-[#FFFFFF] p-6 text-gray-900 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] focus:outline-none"
              >
                {/* Header */}
                <div className="flex items-center justify-between pb-4 border-b border-[#E5E7EB]">
                  <Dialog.Title className="text-[20px] font-bold text-gray-900">
                    Create Post
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                      aria-label="Close modal"
                    >
                      <X className="h-6 w-6" />
                    </button>
                  </Dialog.Close>
                </div>

                {/* Body Content */}
                <div className="py-4 space-y-4 max-h-[70vh] overflow-y-auto pr-1">
                  {submitError && (
                    <div className="rounded-lg bg-red-50 p-3 text-xs text-red-600 border border-red-200">
                      {submitError}
                    </div>
                  )}

                  <PostComposer
                    content={content}
                    onChangeContent={handleContentChange}
                    images={images}
                    onAddImages={addImages}
                    onRemoveImage={removeImage}
                    isCompressing={isCompressing}
                    linkUrl={linkUrl}
                    onChangeLinkUrl={handleLinkUrlChange}
                    linkPreview={linkPreview}
                    onRemoveLinkPreview={clearLinkPreview}
                    isLinkLoading={isLinkLoading}
                  />
                </div>

                {/* Footer Action Buttons */}
                <div className="flex items-center justify-between pt-4 border-t border-[#E5E7EB]">
                  <button
                    type="button"
                    onClick={onClose}
                    className="h-[40px] rounded-[8px] border border-[#E5E7EB] px-5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isPostDisabled}
                    className="flex items-center justify-center gap-2 h-[40px] rounded-[8px] bg-blue-600 px-6 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Posting...</span>
                      </>
                    ) : (
                      <span>Post</span>
                    )}
                  </button>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
