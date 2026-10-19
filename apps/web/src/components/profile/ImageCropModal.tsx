"use client";

import React, { useCallback, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, AnimatePresence } from "framer-motion";
import ReactCrop, { type PercentCrop, centerCrop, makeAspectCrop } from "react-image-crop";
import { X, Loader2 } from "lucide-react";
import "react-image-crop/dist/ReactCrop.css";
import { cropImageToBlob } from "@/lib/profileUpload";

export interface ImageCropModalProps {
  open: boolean;
  src: string;
  /** 1 for avatar (1:1), 3 for cover (3:1) */
  aspect: number;
  title: string;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void | Promise<void>;
  isUploading?: boolean;
}

const MAX_OUTPUT_WIDTH: Record<number, number> = { 1: 1024, 3: 1536 };

/** Live preview via CSS background trick showing the current crop region. */
function CropPreview({ src, crop }: { src: string; crop?: PercentCrop }) {
  if (!crop || crop.width <= 0 || crop.height <= 0) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        role="img"
        aria-label="Crop preview"
        className="h-24 w-40 rounded-lg border border-[#E5E7EB] bg-gray-100 bg-no-repeat"
        style={{
          backgroundImage: `url(${src})`,
          backgroundSize: `${10000 / crop.width}% ${10000 / crop.height}%`,
          backgroundPosition: `${(crop.x * 100) / (100 - crop.width)}% ${
            (crop.y * 100) / (100 - crop.height)
          }%`,
        }}
      />
      <span className="text-xs text-gray-500">Live preview</span>
    </div>
  );
}

export function ImageCropModal({
  open,
  src,
  aspect,
  title,
  onCancel,
  onConfirm,
  isUploading = false,
}: ImageCropModalProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [crop, setCrop] = useState<PercentCrop>();
  const [error, setError] = useState<string | null>(null);

  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      setCrop(
        centerCrop(
          makeAspectCrop({ unit: "%", width: 90 }, aspect, img.naturalWidth, img.naturalHeight),
          img.naturalWidth,
          img.naturalHeight
        )
      );
    },
    [aspect]
  );

  const handleConfirm = useCallback(async () => {
    const img = imgRef.current;
    if (!img || !crop || crop.width <= 0 || crop.height <= 0 || isUploading) return;
    setError(null);
    try {
      const pixelCrop = {
        x: (crop.x / 100) * img.naturalWidth,
        y: (crop.y / 100) * img.naturalHeight,
        width: (crop.width / 100) * img.naturalWidth,
        height: (crop.height / 100) * img.naturalHeight,
      };
      const blob = await cropImageToBlob(img, pixelCrop, MAX_OUTPUT_WIDTH[aspect] ?? 1024);
      await onConfirm(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to crop image. Please try again.");
    }
  }, [imgRef, crop, aspect, isUploading, onConfirm]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o && !isUploading) onCancel();
      }}
    >
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
              />
            </Dialog.Overlay>

            <Dialog.Content asChild>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="fixed left-1/2 top-1/2 z-50 w-full max-w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-[16px] bg-[#FFFFFF] p-6 text-gray-900 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] focus:outline-none"
              >
                <div className="flex items-center justify-between pb-4 border-b border-[#E5E7EB]">
                  <Dialog.Title className="text-[20px] font-bold text-gray-900">
                    {title}
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      onClick={onCancel}
                      disabled={isUploading}
                      className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors disabled:opacity-50"
                      aria-label="Close modal"
                    >
                      <X className="h-6 w-6" />
                    </button>
                  </Dialog.Close>
                </div>

                <div className="py-4 space-y-4 max-h-[70vh] overflow-y-auto pr-1">
                  {error && (
                    <div
                      role="alert"
                      className="rounded-lg bg-red-50 p-3 text-sm text-red-600 border border-red-200"
                    >
                      {error}
                    </div>
                  )}

                  <p className="text-sm text-gray-600">
                    Drag the crop handles or use arrow keys to adjust the selection.
                  </p>

                  <div className="flex flex-col items-center gap-4">
                    <ReactCrop
                      crop={crop}
                      onChange={(_crop, percentCrop) => setCrop(percentCrop)}
                      aspect={aspect}
                      ruleOfThirds
                      ariaLabels={{
                        cropArea: `Crop selection for ${title}. Use arrow keys to move, Shift with arrow keys to resize.`,
                        nwDragHandle: "North-west resize handle",
                        nDragHandle: "North resize handle",
                        neDragHandle: "North-east resize handle",
                        eDragHandle: "East resize handle",
                        seDragHandle: "South-east resize handle",
                        sDragHandle: "South resize handle",
                        swDragHandle: "South-west resize handle",
                        wDragHandle: "West resize handle",
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        ref={imgRef}
                        src={src}
                        alt="Preview to crop"
                        onLoad={handleImageLoad}
                        className="max-h-[320px] max-w-full select-none"
                        draggable={false}
                      />
                    </ReactCrop>

                    <CropPreview src={src} crop={crop} />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#E5E7EB]">
                  <button
                    type="button"
                    onClick={onCancel}
                    disabled={isUploading}
                    className="h-[40px] rounded-[8px] border border-[#E5E7EB] px-5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={isUploading || !crop}
                    className="flex h-[40px] items-center justify-center gap-2 rounded-[8px] bg-violet-600 px-6 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        <span>Uploading…</span>
                      </>
                    ) : (
                      <span>Crop & Upload</span>
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
