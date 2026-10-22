"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { VerificationBadge, type VerificationLevel } from "@/components/VerificationBadge";
import { ResponsiveImage } from "@/components/ui/ResponsiveImage";
import { useReducedMotion } from "@/hooks/useReducedMotion";

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
  /** Whether the author holds an on-chain attestation. */
  isVerified?: boolean;
  /** Provenance of the author's verification, when verified. */
  verificationLevel?: VerificationLevel | null;
}

interface PostCardProps {
  post: Post;
  query?: string;
  onLike?: () => void;
  onTip?: () => void;
  isLiked?: boolean;
  isTipping?: boolean;
  tourAnchor?: boolean;
  disabled?: boolean;
  /** Above the fold (e.g. one of the first feed posts): preload the post image. */
  priority?: boolean;
  /** `sizes` for the post image; defaults to the max-w-2xl feed column. */
  imageSizes?: string;
  "data-testid"?: string;
}

// The feed column is max-w-2xl (672px) minus page padding.
export const FEED_POST_IMAGE_SIZES = "(min-width: 672px) 640px, 100vw";

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
  disabled = false,
  priority = false,
  imageSizes = FEED_POST_IMAGE_SIZES,
  "data-testid": dataTestId,
}: PostCardProps) {
  const likeCount = getPostLikeCount(post);
  const [animateLikeCount, setAnimateLikeCount] = useState(false);
  const [previousLikeCount, setPreviousLikeCount] = useState(likeCount);
  const prefersReducedMotion = useReducedMotion();

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

  const layoutId = `post-${post.id}`;

  return (
    <motion.article
      layoutId={layoutId}
      data-testid={dataTestId}
      className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3 md:p-4 lg:p-5 shadow-lg transition-all duration-300 hover:border-violet-500/40 hover:shadow-violet-950/10"
      style={{ contain: "layout" }}
      transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.3, ease: "easeInOut" }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <motion.span
            layoutId={`${layoutId}-author`}
            className="font-medium hover:text-[var(--foreground)] transition-colors"
            title={post.author}
          >
            By {formatAuthor(post.author)}
          </motion.span>
          {post.isVerified && (
            <VerificationBadge
              level={post.verificationLevel ?? "identity"}
              subject={post.username || formatAuthor(post.author)}
            />
          )}
        </span>
        <time className="text-xs text-[var(--text-muted)]">{formatDate(post)}</time>
      </div>

      <motion.p
        layoutId={`${layoutId}-content`}
        className="whitespace-pre-wrap break-words leading-relaxed text-[var(--foreground)] mb-4 text-base"
        style={{ contain: "layout" }}
      >
        {highlightText(post.content, query)}
      </motion.p>

      {post.imageUrl && (
        <div className="relative mb-4 aspect-video overflow-hidden rounded-lg bg-zinc-800">
          <ResponsiveImage
            src={post.imageUrl}
            alt=""
            fill
            sizes={imageSizes}
            priority={priority}
            deferOnSaveData
            className="object-cover"
          />
        </div>
      )}

      <div
        className="flex items-center gap-6 border-t border-[var(--border)]/40 pt-3"
        data-tour={tourAnchor ? "post-actions" : undefined}
      >
        {/* Like Button */}
        <button
          onClick={onLike}
          disabled={disabled}
          className={`flex items-center gap-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
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
          disabled={disabled || isTipping}
          className="flex items-center gap-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--accent-teal)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Tip creator"
        >
          <span className="text-lg">💰</span>
          <span>Tips: {getPostTipTotal(post)}</span>
        </button>
      </div>
    </motion.article>
  );
}

export { PostCardSkeleton } from "@/components/skeletons";
