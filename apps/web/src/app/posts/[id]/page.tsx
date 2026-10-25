"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { LinkoraClient, type Post } from "linkora-sdk";
import { useComments } from "@/hooks/useComments";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useWallet } from "@/hooks/useWallet";
import { X } from "lucide-react";

const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID =
  process.env.NEXT_PUBLIC_CONTRACT_ID ?? "CDD6V66I7G2K2TCHWGLD4QIPZ4E47W4T3HLY3W7YJ4NGRRYUDRF6QYLR";

const MAX_COMMENT_CHARS = 500;
const TOAST_DURATION_MS = 5000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatAddress(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PostDetailPage() {
  const params = useParams();
  const postId = typeof params?.id === "string" ? params.id : null;

  // Post fetch state
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  // Wallet for author address
  const { address } = useWallet();

  // Comment compose state
  const [commentText, setCommentText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // useComments hook — all optimistic logic lives here
  const {
    comments,
    loading: commentsLoading,
    error: commentsError,
    commentError,
    clearCommentError,
    addCommentOptimistic,
    deleteCommentOptimistic,
  } = useComments(postId);

  // ── Post fetch ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!postId) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    const client = new LinkoraClient({ rpcUrl: RPC_URL, contractId: CONTRACT_ID });
    setLoading(true);
    setError(null);
    setNotFound(false);

    client
      .getPost(BigInt(postId))
      .then((postData: any) => {
        if (postData) {
          setPost(postData);
        } else {
          setNotFound(true);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load post");
      })
      .finally(() => setLoading(false));
  }, [postId]);

  // ── Auto-dismiss toast ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!commentError) return;
    const timer = setTimeout(clearCommentError, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [commentError, clearCommentError]);

  // ── Copy link ──────────────────────────────────────────────────────────────

  const handleCopyLink = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 1500);
  }, []);

  // ── Comment submission ─────────────────────────────────────────────────────

  const handleSubmitComment = useCallback(async () => {
    const content = commentText.trim();
    if (!content || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await addCommentOptimistic(content, address ?? "GUSER_ANONYMOUS");
      setCommentText("");
      textareaRef.current?.focus();
    } catch {
      // commentError is set by the hook; toast handles display.
    } finally {
      setIsSubmitting(false);
    }
  }, [commentText, isSubmitting, addCommentOptimistic, address]);

  // Keyboard shortcut: Cmd+Enter / Ctrl+Enter submits
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void handleSubmitComment();
      }
    },
    [handleSubmitComment]
  );

  const remaining = MAX_COMMENT_CHARS - commentText.length;
  const overLimit = remaining < 0;

  const prefersReducedMotion = useReducedMotion();
  const layoutId = `post-${postId}`;

  // ── Loading / error states ─────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="max-w-xl mx-auto px-4 py-12 flex flex-col gap-4">
        <div className="h-6 w-32 bg-gray-800 rounded-lg animate-pulse" />
        <div className="h-40 w-full bg-gray-800 rounded-xl animate-pulse" />
      </main>
    );
  }

  if (notFound || error || !post) {
    return (
      <main className="max-w-xl mx-auto px-4 py-12 flex flex-col gap-6 text-center">
        <div className="text-5xl" aria-hidden="true">
          🔍
        </div>
        <h1 className="text-2xl font-bold text-white">Post Not Found</h1>
        <p className="text-[var(--text-muted)]">
          {error
            ? `Error: ${error}`
            : "This post may not exist or has been removed from the blockchain."}
        </p>
        <Link href="/explore" className="text-violet-500 hover:underline font-semibold">
          ← Back to Explore
        </Link>
      </main>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <AnimatePresence mode="wait">
      <main className="max-w-xl mx-auto px-4 py-12 flex flex-col gap-8">
        <Link
          href="/explore"
          className="inline-block text-sm font-semibold text-violet-500 hover:underline"
        >
          ← Back to Explore
        </Link>

        {/* ── Post card ─────────────────────────────────────────────────────── */}
        <h1 className="sr-only">Post Detail</h1>
        <motion.article
          layoutId={layoutId}
          className="bg-[var(--muted)] border border-[var(--border)] rounded-2xl p-6 shadow-xl flex flex-col gap-4"
          style={{ contain: "layout" }}
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.3, ease: "easeInOut" }}
        >
          {/* Author */}
          <div className="flex items-center gap-3">
            <motion.div
              layoutId={`${layoutId}-avatar`}
              className="w-10 h-10 rounded-full bg-[var(--accent)] flex items-center justify-center text-white font-bold text-sm"
              style={{ contain: "layout" }}
            >
              {post.author.slice(0, 2).toUpperCase()}
            </motion.div>
            <div className="flex flex-col">
              <motion.span layoutId={`${layoutId}-author`} className="text-sm font-bold text-white">
                {formatAddress(post.author)}
              </motion.span>
              <span className="text-xs text-[var(--text-muted)] font-mono">{post.author}</span>
            </div>
          </div>

          {/* Content */}
          <motion.p
            layoutId={`${layoutId}-content`}
            className="text-white text-lg break-words whitespace-pre-wrap leading-relaxed"
            style={{ contain: "layout" }}
          >
            {post.content}
          </motion.p>

          {/* Metrics + share */}
          <div className="border-t border-[var(--border)] pt-4 mt-2 flex flex-wrap items-center gap-6 text-xs text-[var(--text-muted)]">
            <div>
              Likes: <span className="font-bold text-white">{post.like_count.toString()}</span>
            </div>
            <div>
              Tipped:{" "}
              <span className="font-bold text-white">
                {(Number(post.tip_total) / 10_000_000).toFixed(2)} XLM
              </span>
            </div>
            <div>
              Posted:{" "}
              <span className="font-bold text-white">
                {new Date(Number(post.timestamp) * 1000).toLocaleString()}
              </span>
            </div>
            <button
              onClick={handleCopyLink}
              className="ml-auto flex items-center gap-1.5 text-[var(--text-muted)] hover:text-violet-400 transition-colors"
              aria-label="Copy post link to clipboard"
            >
              {copyFeedback ? (
                <>
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  <span className="font-semibold text-violet-400">Copied!</span>
                </>
              ) : (
                <>
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z"
                    />
                  </svg>
                  <span className="font-semibold">Share</span>
                </>
              )}
            </button>
          </div>
        </motion.article>

        {/* ── Comments section ──────────────────────────────────────────────── */}
        <section aria-label="Comments">
          <h2 className="text-lg font-bold text-white mb-4">
            Comments{" "}
            {comments.length > 0 && (
              <span className="text-sm font-normal text-[var(--text-muted)]">
                ({comments.filter((c) => !c.isDeleting).length})
              </span>
            )}
          </h2>

          {/* ── Mutation error toast ─────────────────────────────────────────── */}
          {commentError && (
            <div
              role="alert"
              aria-live="assertive"
              className="flex items-center justify-between gap-3 mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400"
            >
              <span>{commentError}</span>
              <button
                type="button"
                onClick={clearCommentError}
                aria-label="Dismiss error"
                className="shrink-0 text-red-400/70 hover:text-red-300 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* ── Compose box ─────────────────────────────────────────────────── */}
          <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4 flex flex-col gap-3">
            <label htmlFor="comment-input" className="sr-only">
              Write a comment
            </label>
            <textarea
              id="comment-input"
              ref={textareaRef}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              placeholder="Add a comment… (⌘↵ to submit)"
              disabled={isSubmitting}
              aria-label="Write a comment"
              aria-describedby={overLimit ? "comment-char-limit" : undefined}
              aria-invalid={overLimit}
              className={`w-full resize-none rounded-lg border px-3 py-2 text-sm bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 transition-colors ${
                overLimit ? "border-red-500" : "border-[var(--border)]"
              }`}
            />
            <div className="flex items-center justify-between">
              <span
                id="comment-char-limit"
                className={`text-xs ${
                  overLimit
                    ? "text-red-500 font-semibold"
                    : remaining <= 50
                      ? "text-yellow-500"
                      : "text-[var(--text-muted)]"
                }`}
                aria-live="polite"
              >
                {remaining} remaining
              </span>
              <button
                type="button"
                onClick={() => void handleSubmitComment()}
                disabled={!commentText.trim() || isSubmitting || overLimit}
                className="rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? "Posting…" : "Comment"}
              </button>
            </div>
          </div>

          {/* ── Comment list ─────────────────────────────────────────────────── */}
          {commentsLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4 space-y-2"
                >
                  <div className="h-3 w-24 rounded bg-zinc-700" />
                  <div className="h-3 w-full rounded bg-zinc-700" />
                  <div className="h-3 w-3/4 rounded bg-zinc-700" />
                </div>
              ))}
            </div>
          ) : commentsError ? (
            <p className="text-sm text-red-400 text-center py-4">{commentsError}</p>
          ) : comments.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-6">
              No comments yet. Be the first!
            </p>
          ) : (
            <ul className="space-y-3" aria-label="Comment list">
              {comments.map((comment) => (
                <li
                  key={comment.id}
                  aria-hidden={comment.isDeleting}
                  className={`rounded-xl border bg-[var(--muted)] p-4 flex flex-col gap-2 transition-all duration-300 ${
                    comment.isDeleting
                      ? "opacity-0 scale-95 pointer-events-none border-[var(--border)]"
                      : comment.isOptimistic
                        ? "opacity-60 border-violet-500/30"
                        : "opacity-100 border-[var(--border)]"
                  }`}
                >
                  {/* Comment header */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[var(--foreground)]">
                        {formatAddress(comment.author)}
                      </span>
                      {comment.isOptimistic && !comment.isDeleting && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold text-violet-400">
                          {/* Spinner */}
                          <span
                            className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-violet-400 border-t-transparent"
                            aria-hidden="true"
                          />
                          Posting…
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <time
                        dateTime={comment.createdAt}
                        className="text-[10px] text-[var(--text-muted)]"
                      >
                        {formatRelativeTime(comment.createdAt)}
                      </time>
                      {/* Only show delete for own comments (or all in demo) */}
                      {!comment.isOptimistic && (
                        <button
                          type="button"
                          onClick={() => void deleteCommentOptimistic(comment.id)}
                          aria-label={`Delete comment by ${formatAddress(comment.author)}`}
                          className="text-[var(--text-muted)] hover:text-red-400 transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Comment body */}
                  <p className="text-sm text-[var(--foreground)] whitespace-pre-wrap break-words leading-relaxed">
                    {comment.content}
                  </p>

                  {/* Per-comment error (reserved for future inline display) */}
                  {comment.error && (
                    <p role="alert" className="text-[10px] text-red-400 text-right">
                      {comment.error}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </AnimatePresence>
  );
}
