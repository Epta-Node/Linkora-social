"use client";

import { PostCard, type Post } from "@/components/PostCard";
import { useDeletePostMutation } from "@/hooks/useDeletePostMutation";
import { useLikeMutation } from "@/hooks/useLikeMutation";

interface OptimisticPostCardProps {
  post: Post;
  /** Connected wallet address; required to show the delete affordance. */
  currentUser?: string | null;
  /** Hide the post immediately while the delete request is in flight. */
  onOptimisticDelete?: (postId: string | number) => void;
  /** Put the post back when the delete fails. */
  onDeleteFailed?: (postId: string | number) => void;
  /** Load the card's hero image eagerly when it sits above the fold. */
  priority?: boolean;
  "data-testid"?: string;
}

/**
 * A feed post with optimistic actions.
 *
 * - Like: the heart and counter flip immediately; a failure rolls both back
 *   and shows a toast.
 * - Delete (author only): the post is hidden immediately; a failure restores
 *   it and shows a toast.
 *
 * The paginated feed owns its own list, so it receives callbacks for the
 * optimistic hide/restore instead of relying on the query cache.
 */
export function OptimisticPostCard({
  post,
  currentUser,
  onOptimisticDelete,
  onDeleteFailed,
  priority,
  "data-testid": dataTestId,
}: OptimisticPostCardProps) {
  const like = useLikeMutation({
    postId: post.id,
    user: currentUser,
    initialLikeCount: Number(post.like_count ?? 0),
  });

  const remove = useDeletePostMutation({
    onOptimisticRemove: onOptimisticDelete,
    onRestore: onDeleteFailed,
  });

  const canDelete = Boolean(currentUser) && currentUser === post.author;

  return (
    <PostCard
      data-testid={dataTestId}
      post={{ ...post, like_count: like.likeCount }}
      priority={priority}
      isLiked={like.liked}
      onLike={() => {
        void like.like();
      }}
      onDelete={canDelete ? () => remove.deletePost(post.id) : undefined}
      isDeleting={remove.isPending && String(remove.pendingPostId) === String(post.id)}
    />
  );
}
