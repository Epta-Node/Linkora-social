"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Image as ImageIcon, UploadCloud, User, Loader2 } from "lucide-react";
import { validateImageFile } from "@/lib/media";
import {
  compressCroppedBlob,
  fetchProfileImageUrl,
  uploadWithProgress,
  type ProfileImageKind,
} from "@/lib/profileUpload";
import { ImageCropModal } from "./ImageCropModal";

export interface ProfileImageUploaderProps {
  address: string;
  kind: ProfileImageKind;
  onUploaded?: (url: string) => void;
}

const KIND_CONFIG: Record<ProfileImageKind, { label: string; aspect: number; alt: string }> = {
  avatar: { label: "Profile picture", aspect: 1, alt: "profile avatar" },
  cover: { label: "Cover image", aspect: 3, alt: "profile cover" },
};

export function ProfileImageUploader({ address, kind, onUploaded }: ProfileImageUploaderProps) {
  const config = KIND_CONFIG[kind];
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "cropping" | "uploading">("idle");
  const [progress, setProgress] = useState(0);
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [pending, setPending] = useState<{ file: File; dataUrl: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProfileImageUrl(address, kind).then((url) => {
      if (!cancelled && url) setDisplayUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [address, kind]);

  const handleFiles = useCallback(async (files: FileList | File[] | null) => {
    const file = files?.[0];
    if (!file) return;
    setError(null);

    const validation = validateImageFile(file);
    if (!validation.valid) {
      setError(validation.error || "Invalid file.");
      return;
    }

    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Could not read the selected file."));
        reader.readAsDataURL(file);
      });
      setPending({ file, dataUrl });
      setStatus("cropping");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the selected file.");
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
      // Allow re-selecting the same file later
      e.target.value = "";
    },
    [handleFiles]
  );

  const handleConfirm = useCallback(
    async (blob: Blob) => {
      if (!pending) return;
      setStatus("uploading");
      setProgress(0);
      setError(null);
      try {
        const compressed = await compressCroppedBlob(blob);
        const file = new File([compressed], `${kind}.jpg`, {
          type: compressed.type || "image/jpeg",
        });
        const url = await uploadWithProgress(file, kind, address, setProgress);
        setDisplayUrl(url);
        onUploaded?.(url);
        setPending(null);
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
        setStatus("cropping");
      }
    },
    [pending, kind, address, onUploaded]
  );

  const handleCancelCrop = useCallback(() => {
    setPending(null);
    setStatus("idle");
  }, []);

  const openPicker = useCallback(() => inputRef.current?.click(), []);

  const previewClasses =
    kind === "avatar"
      ? "h-24 w-24 rounded-full border-2 border-dashed border-gray-300 bg-gray-50"
      : "aspect-[3/1] w-full max-w-sm rounded-xl border-2 border-dashed border-gray-300 bg-gray-50";

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-gray-700" id={`${kind}-upload-label`}>
        {config.label}
      </p>

      <div
        role="button"
        tabIndex={0}
        aria-label={`${config.label}: drag and drop an image here, or press Enter to browse files`}
        aria-describedby={`${kind}-upload-hint`}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 p-4 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
          kind === "avatar" ? "w-40" : "w-full max-w-sm"
        } ${dragOver ? "border-violet-500 bg-violet-50" : "hover:bg-gray-100"}`}
      >
        {displayUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayUrl}
            alt={`Current ${config.alt}`}
            className={`${previewClasses.replace("border-dashed", "border-solid")} object-cover`}
          />
        ) : (
          <div className={`${previewClasses} flex items-center justify-center text-gray-400`}>
            {kind === "avatar" ? (
              <User className="h-10 w-10" aria-hidden="true" />
            ) : (
              <ImageIcon className="h-10 w-10" aria-hidden="true" />
            )}
          </div>
        )}

        <span className="flex items-center gap-1 text-sm text-gray-600">
          <UploadCloud className="h-4 w-4" aria-hidden="true" />
          Drag &amp; drop or <span className="font-semibold text-violet-600">browse</span>
        </span>
        <span id={`${kind}-upload-hint`} className="text-xs text-gray-400">
          JPG, PNG or WebP · max 5MB · {config.aspect}:1 crop
        </span>
      </div>

      <input
        type="file"
        ref={inputRef}
        onChange={handleInputChange}
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-600 border border-red-200"
        >
          {error}
        </div>
      )}

      <div aria-live="polite">
        {status === "uploading" && (
          <div className="max-w-sm space-y-1">
            <div
              role="progressbar"
              aria-label={`${config.label} upload progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              className="h-2 w-full overflow-hidden rounded-full bg-gray-200"
            >
              <div
                className="h-full rounded-full bg-violet-600 transition-[width] duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="flex items-center gap-1 text-xs text-gray-500">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Uploading… {progress}%
            </p>
          </div>
        )}
      </div>

      {pending && (
        <ImageCropModal
          open={status === "cropping" || status === "uploading"}
          src={pending.dataUrl}
          aspect={config.aspect}
          title={`Crop ${config.label.toLowerCase()}`}
          onCancel={handleCancelCrop}
          onConfirm={handleConfirm}
          isUploading={status === "uploading"}
        />
      )}
    </div>
  );
}
