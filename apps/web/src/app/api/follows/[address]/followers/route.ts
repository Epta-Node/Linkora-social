import { NextRequest, NextResponse } from "next/server";

const FRIENDLY_USERS = [
  "stellar_dev",
  "crypto_enthusiast",
  "linkora_fan",
  "soroban_builder",
  "defi_explorer",
  "nft_collector",
  "dao_member",
  "web3_builder",
  "crypto_trader",
  "soroban_dev",
  "alice",
  "bob",
  "charlie",
  "dave",
  "eve",
  "frank",
  "grace",
  "heidi",
  "ivan",
  "judy",
  "mallory",
  "oscar",
  "peggy",
  "rupert",
  "sybil",
];

const MOCK_USERS = Array.from({ length: 75 }, (_, i) => {
  const index = i + 1;
  const prefix = String.fromCharCode(65 + (i % 26));
  const address = `G${prefix}${Array(53).fill("X").join("")}${index.toString().padStart(2, "0")}`;
  const username = i < FRIENDLY_USERS.length ? FRIENDLY_USERS[i] : `user_${index}`;
  return { address, username };
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get("limit") || "20", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const indexerUrl = process.env.NEXT_PUBLIC_INDEXER_URL || "http://localhost:3001";

  try {
    const res = await fetch(
      `${indexerUrl}/api/follows/${address}/followers?limit=${limit}&offset=${offset}`,
      {
        next: { revalidate: 0 },
      }
    );

    if (res.ok) {
      const data = await res.json();
      const enrichedFollowers = await Promise.all(
        (data.followers || []).map(async (addr: string) => {
          try {
            const pRes = await fetch(`${indexerUrl}/api/profiles/${addr}`);
            if (pRes.ok) {
              const pData = await pRes.json();
              return { address: addr, username: pData.username || `user_${addr.slice(0, 6)}` };
            }
          } catch {}
          return { address: addr, username: `user_${addr.slice(0, 6)}` };
        })
      );
      return NextResponse.json({
        address: data.address || address,
        followers: enrichedFollowers,
        total: data.total || 0,
        limit: data.limit || limit,
        offset: data.offset || offset,
        has_more: data.has_more ?? false,
      });
    }
  } catch (err) {
    // Fallback
  }

  const filteredMock = MOCK_USERS.filter((u) => u.address.toLowerCase() !== address.toLowerCase());
  const paginated = filteredMock.slice(offset, offset + limit);

  return NextResponse.json({
    address,
    followers: paginated,
    total: filteredMock.length,
    limit,
    offset,
    has_more: offset + paginated.length < filteredMock.length,
  });
}
