"use client";

import {
  formatAuthor,
  getPostDate,
  getPostLikeCount,
  getPostTipTotal,
  type Post,
} from "@/components/PostCard";

interface MasonryCardProps {
  post: Post;
  onLike?: () => void;
  onTip?: () => void;
  isLiked?: boolean;
  isTipping?: boolean;
}

// Deterministic (not Math.random) so server and client render the same aspect
// ratio for a given post — avoids hydration mismatch and layout shift.
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

const PLACEHOLDER_RATIOS = [5 / 4, 1, 4 / 5, 3 / 4, 6 / 5];
const PLACEHOLDER_GRADIENTS = [
  "linear-gradient(135deg, #7c3aed, #06b6d4)",
  "linear-gradient(135deg, #3b82f6, #7c3aed)",
  "linear-gradient(135deg, #06b6d4, #3b82f6)",
  "linear-gradient(135deg, #f59e0b, #7c3aed)",
];

function splitTitleAndBody(content: string): { title: string; body: string } {
  const firstLineBreak = content.indexOf("\n");
  const firstLine = firstLineBreak === -1 ? content : content.slice(0, firstLineBreak);

  if (firstLine.length <= 60) {
    return { title: firstLine, body: content.slice(firstLine.length).trim() };
  }
  return { title: `${firstLine.slice(0, 60)}…`, body: content };
}

export function MasonryCard({ post, onLike, onTip, isLiked, isTipping }: MasonryCardProps) {
  const displayName = post.username || formatAuthor(post.author);
  const date = getPostDate(post);
  const likeCount = getPostLikeCount(post);
  const tipTotal = getPostTipTotal(post);
  const { title, body } = splitTitleAndBody(post.content);

  const hash = hashString(String(post.id));
  const aspectRatio = PLACEHOLDER_RATIOS[hash % PLACEHOLDER_RATIOS.length];
  const gradient = PLACEHOLDER_GRADIENTS[hash % PLACEHOLDER_GRADIENTS.length];

  return (
    <article className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--color-bg)] shadow-md transition-shadow hover:shadow-lg">
      {post.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.imageUrl} alt="" className="w-full h-auto" loading="lazy" />
      ) : (
        <div
          className="w-full flex items-center justify-center text-white/70 text-3xl font-bold"
          style={{ aspectRatio, background: gradient }}
          aria-hidden="true"
        >
          {displayName[0]?.toUpperCase()}
        </div>
      )}

      <div className="p-3">
        <div className="mb-2 flex items-center gap-2">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 text-xs font-semibold text-white"
            aria-hidden="true"
          >
            {displayName[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <p
              className="truncate text-xs font-semibold text-[var(--color-text-primary)]"
              title={post.author}
            >
              {displayName}
            </p>
            {date && (
              <time className="text-[10px] text-[var(--color-text-secondary)]">
                {date.toLocaleDateString()}
              </time>
            )}
          </div>
        </div>

        {title && (
          <h3 className="mb-1 text-sm font-bold leading-snug text-[var(--color-text-primary)] line-clamp-2">
            {title}
          </h3>
        )}
        {body && (
          <p className="mb-2 text-xs leading-relaxed text-[var(--color-text-secondary)] line-clamp-3">
            {body}
          </p>
        )}

        <div className="flex items-center gap-4 pt-1">
          <button
            onClick={onLike}
            className={`flex min-h-[44px] items-center gap-1.5 text-xs font-medium transition-colors ${
              isLiked
                ? "text-[var(--accent-coral)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--accent-coral)]"
            }`}
            aria-label={isLiked ? "Unlike post" : "Like post"}
          >
            <span className="text-base">{isLiked ? "❤️" : "🤍"}</span>
            <span>{likeCount}</span>
          </button>

          <button
            onClick={onTip}
            disabled={isTipping}
            className="flex min-h-[44px] items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--accent-teal)] disabled:opacity-50"
            aria-label="Tip creator"
          >
            <span className="text-base">💰</span>
            <span>{tipTotal}</span>
          </button>
        </div>
      </div>
    </article>
  );
}
