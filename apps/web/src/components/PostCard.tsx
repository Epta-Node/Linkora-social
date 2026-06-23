"use client";

export interface Post {
  id: string | number;
  author: string;
  content: string;
  tip_total?: string | number;
  timestamp?: string | number;
  created_at?: string;
}

interface PostCardProps {
  post: Post;
  query?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightText(text: string, query = "") {
  const trimmed = query.trim();
  if (!trimmed) return text;

  const parts = text.split(new RegExp(`(${escapeRegExp(trimmed)})`, "gi"));
  return parts.map((part, index) =>
    part.toLowerCase() === trimmed.toLowerCase() ? (
      <mark key={`${part}-${index}`} className="rounded bg-yellow-300 px-1 text-black">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export function getPostDate(post: Post): Date | null {
  const raw = post.created_at ?? post.timestamp;
  if (raw === undefined || raw === null || raw === "") return null;

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric);
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getPostTipTotal(post: Post): number {
  const value = Number(post.tip_total ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function formatDate(post: Post): string {
  const date = getPostDate(post);
  return date ? date.toLocaleDateString() : "Unknown date";
}

function formatAuthor(author: string): string {
  return author.length > 16 ? `${author.slice(0, 6)}...${author.slice(-4)}` : author;
}

export function PostCard({ post, query }: PostCardProps) {
  return (
    <article className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--text-muted)]">
        <span title={post.author}>By {formatAuthor(post.author)}</span>
        <time>{formatDate(post)}</time>
      </div>

      <p className="whitespace-pre-wrap break-words leading-7 text-[var(--foreground)]">
        {highlightText(post.content, query)}
      </p>

      <div className="mt-4 text-sm font-medium text-violet-300">
        Tips: {getPostTipTotal(post)}
      </div>
    </article>
  );
}

export function PostCardSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-[var(--border)] bg-[var(--muted)] p-5">
      <div className="mb-4 flex justify-between">
        <div className="h-4 w-28 rounded bg-zinc-700" />
        <div className="h-4 w-20 rounded bg-zinc-700" />
      </div>
      <div className="space-y-3">
        <div className="h-4 w-full rounded bg-zinc-700" />
        <div className="h-4 w-4/5 rounded bg-zinc-700" />
        <div className="h-4 w-2/3 rounded bg-zinc-700" />
      </div>
      <div className="mt-4 h-4 w-24 rounded bg-zinc-700" />
    </div>
  );
}
