"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { LinkoraClient, type Post } from "linkora-sdk";

const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID =
  process.env.NEXT_PUBLIC_CONTRACT_ID ?? "CDD6V66I7G2K2TCHWGLD4QIPZ4E47W4T3HLY3W7YJ4NGRRYUDRF6QYLR";

export default function PostDetailPage() {
  const params = useParams();
  const postId = typeof params?.id === "string" ? params.id : null;

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const handleCopyLink = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 1500);
  }, []);

  useEffect(() => {
    if (!postId) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    const client = new LinkoraClient({
      rpcUrl: RPC_URL,
      contractId: CONTRACT_ID,
    });

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
        console.error("Failed to fetch post:", err);
        setError(err instanceof Error ? err.message : "Failed to load post");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [postId]);

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
        <div className="text-5xl" aria-hidden="true">🔍</div>
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

  return (
    <main className="max-w-xl mx-auto px-4 py-12">
      <Link
        href="/explore"
        className="inline-block mb-6 text-sm font-semibold text-violet-500 hover:underline"
      >
        ← Back to Explore
      </Link>

      <h1 className="sr-only">Post Detail</h1>
      <article className="bg-[var(--muted)] border border-[var(--border)] rounded-2xl p-6 shadow-xl flex flex-col gap-4">
        {/* Author */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[var(--accent)] flex items-center justify-center text-white font-bold text-sm">
            {post.author.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold text-white">
              {post.author.slice(0, 6)}...{post.author.slice(-4)}
            </span>
            <span className="text-xs text-[var(--text-muted)] font-mono">{post.author}</span>
          </div>
        </div>

        {/* Content */}
        <p className="text-white text-lg break-words whitespace-pre-wrap leading-relaxed">
          {post.content}
        </p>

        {/* Footer/Metrics */}
        <div className="border-t border-[var(--border)] pt-4 mt-2 flex items-center gap-6 text-xs text-[var(--text-muted)]">
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

          {/* Share / Copy link */}
          <button
            onClick={handleCopyLink}
            className="ml-auto flex items-center gap-1.5 text-[var(--text-muted)] hover:text-violet-400 transition-colors"
            aria-label="Copy post link to clipboard"
          >
            {copyFeedback ? (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span className="font-semibold text-violet-400">Copied!</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                </svg>
                <span className="font-semibold">Share</span>
              </>
            )}
          </button>
        </div>
      </article>
    </main>
  );
}
