import { NextResponse } from "next/server";

export interface PostPayload {
  id?: string | number;
  content: string;
  author?: string;
  images?: string[];
  linkUrl?: string;
}

// In-memory fallback post store for API route demonstration
const mockPosts: Array<{
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
}> = [
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

export async function GET() {
  return NextResponse.json({ posts: mockPosts });
}

export async function POST(request: Request) {
  try {
    const body: PostPayload = await request.json();

    if (!body.content || !body.content.trim()) {
      return NextResponse.json({ error: "Post content cannot be empty." }, { status: 400 });
    }

    const newPost = {
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
