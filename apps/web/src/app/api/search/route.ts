import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";

  const mockPosts = [
    {
      id: "old-post",
      author: "GALICE1234567890",
      content: "A stellar builders update from last month.",
      tip_total: 2,
      timestamp: 1_733_011_200,
    },
    {
      id: "new-post",
      author: "GBOB1234567890",
      content: "Fresh Stellar launch notes.",
      tip_total: 50,
      timestamp: 1_738_368_000,
    },
  ];

  if (!q) {
    return NextResponse.json({ posts: [] });
  }

  const posts = mockPosts.filter((p) => p.content.toLowerCase().includes(q.toLowerCase()));
  return NextResponse.json({ posts: posts.length > 0 ? posts : mockPosts });
}
