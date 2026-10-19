import { NextRequest, NextResponse } from "next/server";

export interface PostPayload {
  id?: string | number;
  content: string;
  author?: string;
  images?: string[];
  linkUrl?: string;
}

export interface Post {
  id: string;
  author: string;
  username: string;
  content: string;
  images?: string[];
  linkUrl?: string;
  tip_total: number;
  like_count: number;
  created_at: string;
  timestamp: number;
}

// In-memory fallback post store for API route demonstration
const mockPosts: Post[] = [
  {
    id: "post-1",
    author: "GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    username: "stellar_dev",
    content: "Just deployed my first smart contract on Stellar! 🚀",
    tip_total: 100,
    like_count: 5,
    created_at: new Date(Date.now() - 3600000).toISOString(),
    timestamp: Math.floor(Date.now() / 1000) - 3600,
  },
  {
    id: "post-2",
    author: "GXYZ9876543210ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    username: "crypto_enthusiast",
    content: "The SocialFi ecosystem is growing fast. Excited to be part of it!",
    tip_total: 50,
    like_count: 3,
    created_at: new Date(Date.now() - 7200000).toISOString(),
    timestamp: Math.floor(Date.now() / 1000) - 7200,
  },
];

interface PaginatedResponse {
  posts: Post[];
  cursor?: string;
  hasMore: boolean;
}

const PAGE_SIZE = 10;

/**
 * Decode cursor to get the starting index.
 * Cursor format: base64(index)
 */
function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const index = parseInt(decoded, 10);
    return isNaN(index) || index < 0 ? 0 : index;
  } catch {
    return 0;
  }
}

/**
 * Encode cursor from index.
 * Cursor format: base64(index)
 */
function encodeCursor(index: number): string {
  return Buffer.from(index.toString(), 'utf-8').toString('base64');
}

/**
 * GET /api/posts?cursor=<cursor>
 *
 * Cursor-based pagination for posts feed (Issue #1659).
 * - Stable cursor format (base64-encoded index)
 * - Prevents offset/limit issues with insertions/deletions
 * - Returns `hasMore` flag for infinite scrolling
 * - Cursor is opaque to client (implementation detail)
 */
export async function GET(request: NextRequest): Promise<NextResponse<PaginatedResponse>> {
  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get('cursor') || undefined;

  const startIndex = decodeCursor(cursor);
  const endIndex = Math.min(startIndex + PAGE_SIZE, mockPosts.length);

  const posts = mockPosts.slice(startIndex, endIndex);
  const hasMore = endIndex < mockPosts.length;

  const response: PaginatedResponse = {
    posts,
    hasMore,
  };

  // Include next cursor only if there are more results
  if (hasMore) {
    response.cursor = encodeCursor(endIndex);
  }

  return NextResponse.json(response);
}

export async function POST(request: Request) {
  try {
    const body: PostPayload = await request.json();

    if (!body.content || !body.content.trim()) {
      return NextResponse.json({ error: "Post content cannot be empty." }, { status: 400 });
    }

    const newPost: Post = {
      id: `post-${Date.now()}`,
      author: body.author || "GUSER1234567890ANONYMOUS",
      username: "you",
      content: body.content,
      images: body.images || [],
      linkUrl: body.linkUrl || "",
      tip_total: 0,
      like_count: 0,
      created_at: new Date().toISOString(),
      timestamp: Math.floor(Date.now() / 1000),
    };

    mockPosts.unshift(newPost);

    return NextResponse.json({ success: true, post: newPost }, { status: 201 });
  } catch (error) {
    console.error("Error creating post:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
