import { NextResponse } from "next/server";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_SIZE_BYTES } from "@/lib/media";

const VALID_KINDS = ["avatar", "cover"] as const;
type Kind = (typeof VALID_KINDS)[number];

// In-memory store keyed by `${kind}:${address}` — mirrors the mock pattern
// used by /api/posts. Swap for real IPFS/S3 storage later.
const profileImages = new Map<string, string>();

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const kind = formData.get("kind") as string | null;
    const address = formData.get("address") as string | null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }
    if (!kind || !VALID_KINDS.includes(kind as Kind)) {
      return NextResponse.json(
        { error: 'Invalid image kind. Must be "avatar" or "cover".' },
        { status: 400 }
      );
    }
    if (!address || typeof address !== "string" || address.length > 100) {
      return NextResponse.json({ error: "Invalid address." }, { status: 400 });
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type.toLowerCase())) {
      return NextResponse.json(
        { error: `Unsupported file type (${file.type}). Accepted formats: JPG, PNG, WebP.` },
        { status: 400 }
      );
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File size exceeds ${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)}MB limit.` },
        { status: 400 }
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const dataUrl = `data:${file.type};base64,${bytes.toString("base64")}`;
    const key = `${kind}:${address}`;
    profileImages.set(key, dataUrl);

    return NextResponse.json({ success: true, url: dataUrl }, { status: 201 });
  } catch (error) {
    console.error("Error uploading profile image:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  const kind = searchParams.get("kind") as Kind | null;

  if (!address || !kind || !VALID_KINDS.includes(kind)) {
    return NextResponse.json(
      { error: "Query params address and kind are required." },
      { status: 400 }
    );
  }

  return NextResponse.json({ url: profileImages.get(`${kind}:${address}`) ?? null });
}
