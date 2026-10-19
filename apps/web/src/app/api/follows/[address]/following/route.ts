import { NextRequest, NextResponse } from "next/server";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const searchParams = request.nextUrl.searchParams;
  const rawLimit = parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const indexerUrl = process.env.NEXT_PUBLIC_INDEXER_URL || "http://localhost:3001";
  const upstreamTimeout = parseInt(process.env.INDEXER_TIMEOUT_MS || "5000", 10);

  let res: Response;
  try {
    res = await fetch(
      `${indexerUrl}/api/follows/${address}/following?limit=${limit}&offset=${offset}`,
      {
        next: { revalidate: 0 },
        signal: AbortSignal.timeout(upstreamTimeout),
      }
    );
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    return NextResponse.json(
      { error: isTimeout ? "Indexer timed out" : "Indexer unreachable" },
      { status: isTimeout ? 504 : 502 }
    );
  }

  if (!res.ok) {
    return NextResponse.json(
      { error: `Indexer returned ${res.status}` },
      { status: 502 }
    );
  }

  const data = await res.json();
  const enrichedFollowing = await Promise.all(
    (data.following || []).map(async (item: unknown) => {
      const addr =
        typeof item === "string"
          ? item
          : (item as Record<string, string>)?.address || "";
      if (!addr) return null;
      try {
        const pRes = await fetch(`${indexerUrl}/api/profiles/${addr}`, {
          signal: AbortSignal.timeout(upstreamTimeout),
        });
        if (pRes.ok) {
          const pData = await pRes.json();
          return { address: addr, username: pData.username || `user_${addr.slice(0, 6)}` };
        }
      } catch {}
      return { address: addr, username: `user_${addr.slice(0, 6)}` };
    })
  );

  const validFollowing = enrichedFollowing.filter(Boolean);
  return NextResponse.json({
    address: data.address || address,
    following: validFollowing,
    total: data.total ?? validFollowing.length,
    limit,
    offset,
    has_more: data.has_more ?? false,
  });
}
