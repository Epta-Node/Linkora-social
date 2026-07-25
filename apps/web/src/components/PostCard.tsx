"use client";

import { useEffect, useState } from "react";

export interface Post {
  id: string | number;
  author: string;
  username?: string;
  content: string;
  tip_total?: string | number;
  like_count?: string | number;
  timestamp?: string | number;
  created_at?: string;
  imageUrl?: string;
}

interface PostCardProps {
  post: Post;
  query?: string;
  onLike?: () => void;
  onTip?: () => void;
  isLiked?: boolean;
  isTipping?: boolean;
  tourAnchor?: boolean;
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
      <mark
        key={`${part}-${index}`}
        className="rounded bg-yellow-300 px-1 text-black font-semibold"
      >
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

export function getPostLikeCount(post: Post): number {
  const value = Number(post.like_count ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function formatDate(post: Post): string {
  const date = getPostDate(post);
  return date ? date.toLocaleDateString() : "Unknown date";
}

export function formatAuthor(author: string): string {
  return author.length > 16 ? `${author.slice(0, 6)}...${author.slice(-4)}` : author;
}

export function PostCard({
  post,
  query,
  onLike,
  onTip,
  isLiked,
  isTipping,
  tourAnchor,
}: PostCardProps) {
  const likeCount = getPostLikeCount(post);
  const [animateLikeCount, setAnimateLikeCount] = useState(false);
  const [previousLikeCount, setPreviousLikeCount] = useState(likeCount);

  useEffect(() => {
    if (likeCount === previousLikeCount) {
      return;
    }

    setAnimateLikeCount(true);
    setPreviousLikeCount(likeCount);

    const timeout = window.setTimeout(() => {
      setAnimateLikeCount(false);
    }, 220);

    return () => window.clearTimeout(timeout);
  }, [likeCount, previousLikeCount]);

  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3 md:p-4 lg:p-5 shadow-lg transition-all duration-300 hover:border-violet-500/40 hover:shadow-violet-950/10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--text-muted)]">
        <span
          className="font-medium hover:text-[var(--foreground)] transition-colors"
          title={post.author}
        >
          By {formatAuthor(post.author)}
        </span>
        <time className="text-xs text-[var(--text-muted)]">{formatDate(post)}</time>
      </div>

      <p className="whitespace-pre-wrap break-words leading-relaxed text-[var(--foreground)] mb-4 text-base">
        {highlightText(post.content, query)}
      </p>

      <div
        className="flex items-center gap-6 border-t border-[var(--border)]/40 pt-3"
        data-tour={tourAnchor ? "post-actions" : undefined}
      >
        {/* Like Button */}
        <button
          onClick={onLike}
          className={`flex items-center gap-2 text-sm font-medium transition-colors ${
            isLiked
              ? "text-[var(--accent-coral)]"
              : "text-[var(--text-muted)] hover:text-[var(--accent-coral)]"
          }`}
          aria-label={isLiked ? "Unlike post" : "Like post"}
        >
          <span
            className={`text-lg transition-transform duration-200 ${animateLikeCount ? "scale-110" : "scale-100"}`}
          >
            {isLiked ? "❤️" : "🤍"}
          </span>
          <span className={animateLikeCount ? "like-count-animate" : ""}>{likeCount}</span>
        </button>

        {/* Tip Button */}
        <button
          onClick={onTip}
          disabled={isTipping}
          className="flex items-center gap-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--accent-teal)] transition-colors disabled:opacity-50"
          aria-label="Tip creator"
        >
          <span className="text-lg">💰</span>
          <span>Tips: {getPostTipTotal(post)}</span>
        </button>
      </div>
    </article>
  );
}

export function PostCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3 md:p-4 lg:p-5 space-y-4">
      <div className="flex justify-between">
        <div className="h-4 w-28 rounded bg-zinc-800" />
        <div className="h-4 w-20 rounded bg-zinc-800" />
      </div>
      <div className="space-y-3">
        <div className="h-4 w-full rounded bg-zinc-800" />
        <div className="h-4 w-4/5 rounded bg-zinc-800" />
        <div className="h-4 w-2/3 rounded bg-zinc-800" />
      </div>
      <div className="border-t border-[var(--border)]/40 pt-3 flex gap-6">
        <div className="h-5 w-12 rounded bg-zinc-800" />
        <div className="h-5 w-20 rounded bg-zinc-800" />
      </div>
    </div>
  );
}
