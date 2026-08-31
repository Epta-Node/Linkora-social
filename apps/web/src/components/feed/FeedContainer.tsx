"use client";

import React, { useState } from "react";
import { usePosts } from "@/hooks/usePosts";
import { CreatePostModal } from "../modals/CreatePostModal";
import { PostCard, PostCardSkeleton } from "../PostCard";
import { Plus } from "lucide-react";

export interface FeedContainerProps {
  authorAddress?: string;
}

export function FeedContainer({ authorAddress }: FeedContainerProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { posts, loading, error, addPostOptimistic } = usePosts();

  const handleCreatePost = async (data: {
    content: string;
    images: string[];
    linkUrl?: string;
  }) => {
    await addPostOptimistic({
      content: data.content,
      author: authorAddress,
      images: data.images,
      linkUrl: data.linkUrl,
    });
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 space-y-6">
      {/* Create Post Header Banner / Trigger */}
      <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-600 text-white font-bold">
            {authorAddress ? authorAddress.substring(0, 2).toUpperCase() : "U"}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Share an update</h3>
            <p className="text-xs text-[var(--text-muted)]">Compose text, images, or links</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 transition-colors shadow-sm cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>Create Post</span>
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-400 text-center">
          {error}
        </div>
      )}

      {/* Feed list */}
      {loading ? (
        <div className="space-y-4">
          <PostCardSkeleton />
          <PostCardSkeleton />
          <PostCardSkeleton />
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-[var(--border)] rounded-xl">
          <p className="text-gray-500 font-medium">No posts found</p>
          <p className="text-xs text-gray-400 mt-1">Be the first one to create a post!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <div
              key={post.id}
              className={`transition-opacity duration-200 ${
                post.isOptimistic ? "opacity-70 animate-pulse" : "opacity-100"
              }`}
            >
              <PostCard post={post} />
              {post.isOptimistic && (
                <span className="block mt-1 text-right text-[10px] text-violet-400 font-medium">
                  Posting...
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Post Modal */}
      <CreatePostModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreatePost}
        author={authorAddress}
      />
    </div>
  );
}
