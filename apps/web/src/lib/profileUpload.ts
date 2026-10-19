import { MAX_IMAGE_SIZE_BYTES, ALLOWED_IMAGE_TYPES, compressImage } from "@/lib/media";

export type ProfileImageKind = "avatar" | "cover";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Renders the given image region (in natural pixels) to a canvas and returns
 * a JPEG blob. Output width is capped for avatar/cover use cases.
 */
export function cropImageToBlob(
  image: HTMLImageElement,
  crop: CropRect,
  maxOutputWidth: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const { naturalWidth: nw, naturalHeight: nh } = image;
    if (!nw || !nh) {
      reject(new Error("Image failed to load."));
      return;
    }

    const sx = Math.max(0, Math.round(crop.x));
    const sy = Math.max(0, Math.round(crop.y));
    const sw = Math.min(Math.round(crop.width), nw - sx);
    const sh = Math.min(Math.round(crop.height), nh - sy);
    if (sw <= 0 || sh <= 0) {
      reject(new Error("Invalid crop region."));
      return;
    }

    const scale = Math.min(1, maxOutputWidth / sw);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Canvas is not supported in this browser."));
      return;
    }

    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to encode cropped image."));
      },
      "image/jpeg",
      0.9
    );
  });
}

/**
 * Compresses a cropped blob to keep uploads small. Falls back to the
 * original blob if compression fails.
 */
export async function compressCroppedBlob(blob: Blob): Promise<Blob> {
  const file = new File([blob], "profile-image.jpg", { type: blob.type || "image/jpeg" });
  if (file.size <= MAX_IMAGE_SIZE_BYTES && ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return file;
  }
  try {
    return await compressImage(file, { maxSizeMB: 1, maxWidthOrHeight: 1920 });
  } catch {
    return file;
  }
}

/**
 * Uploads a file to the (mock) storage endpoint with progress reporting.
 * Uses XHR because fetch provides no upload progress events.
 * Resolves with the stored URL.
 */
export function uploadWithProgress(
  file: File,
  kind: ProfileImageKind,
  address: string,
  onProgress: (percent: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    form.append("address", address);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };

    xhr.onload = () => {
      let body: { url?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // ignore malformed body
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.url) {
        onProgress(100);
        resolve(body.url);
      } else {
        reject(new Error(body.error || `Upload failed (status ${xhr.status}).`));
      }
    };

    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.onabort = () => reject(new Error("Upload was cancelled."));

    xhr.open("POST", "/api/upload");
    xhr.send(form);
  });
}

/**
 * Fetches the currently stored image URL for an address (mock store).
 */
export async function fetchProfileImageUrl(
  address: string,
  kind: ProfileImageKind
): Promise<string | null> {
  try {
    const res = await fetch(`/api/upload?address=${encodeURIComponent(address)}&kind=${kind}`);
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body.url === "string" ? body.url : null;
  } catch {
    return null;
  }
}
