import { NextResponse } from "next/server";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const rawLimit = parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  if (!q) {
    return NextResponse.json({ profiles: [], total: 0 });
  }

  const indexerUrl = process.env.NEXT_PUBLIC_INDEXER_URL || "http://localhost:3001";

  try {
    const res = await fetch(
      `${indexerUrl}/api/profiles/search?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`,
      { next: { revalidate: 0 }, signal: AbortSignal.timeout(5000) }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `Profile search service returned ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json({
      profiles: data.profiles ?? [],
      total: data.total ?? 0,
      limit,
      offset,
      has_more: data.has_more ?? false,
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    return NextResponse.json(
      { error: isTimeout ? "Profile search timed out" : "Profile search unreachable" },
      { status: isTimeout ? 504 : 502 }
    );
  }
}
