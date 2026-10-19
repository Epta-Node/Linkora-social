/**
 * useAuthorPosts — indexer query scoped to a single author (#1595).
 *
 * The profile screen previously called `useFeed()` and filtered the loaded page
 * client-side: it pulled the whole feed into memory just to show one author's
 * posts, and could only ever show posts inside the currently loaded window.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Post } from "../components/PostCard";
import { AUTHOR_POSTS_PAGE_SIZE, fetchAuthorPosts } from "../utils/sync";

export interface UseAuthorPostsReturn {
  posts: Post[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

export function useAuthorPosts(author: string | undefined): UseAuthorPostsReturn {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(Boolean(author));
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // A request in flight belongs to the author it was started for, so switching
  // authors mid-request neither blocks the new query nor lets the old response
  // land in the new author's list.
  const inFlightRef = useRef<string | null>(null);
  const authorRef = useRef(author);
  const offsetRef = useRef(0);
  const hasMoreRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (replace: boolean) => {
      if (!author || inFlightRef.current === author) return;
      const requestedAuthor = author;
      inFlightRef.current = requestedAuthor;
      setLoading(true);
      setError(null);

      try {
        const offset = replace ? 0 : offsetRef.current;
        const page = await fetchAuthorPosts(requestedAuthor, AUTHOR_POSTS_PAGE_SIZE, offset);
        if (!mountedRef.current || authorRef.current !== requestedAuthor) return;

        setPosts((prev) => {
          if (replace) return page;
          const seen = new Set(prev.map((post) => post.id));
          return [...prev, ...page.filter((post) => !seen.has(post.id))];
        });
        offsetRef.current = offset + page.length;

        const more = page.length >= AUTHOR_POSTS_PAGE_SIZE;
        hasMoreRef.current = more;
        setHasMore(more);
      } catch {
        if (mountedRef.current && authorRef.current === requestedAuthor) {
          setError("Couldn't load this user's posts.");
        }
      } finally {
        if (inFlightRef.current === requestedAuthor) inFlightRef.current = null;
        if (mountedRef.current && authorRef.current === requestedAuthor) setLoading(false);
      }
    },
    [author]
  );

  // Reset and load the first page whenever the author changes (e.g. navigating
  // from one profile to another) so the previous author's posts never linger.
  useEffect(() => {
    authorRef.current = author;
    setPosts([]);
    setError(null);
    offsetRef.current = 0;
    hasMoreRef.current = false;
    setHasMore(false);

    if (author) {
      void load(true);
    } else {
      setLoading(false);
    }
  }, [author, load]);

  const loadMore = useCallback(() => {
    if (hasMoreRef.current) {
      void load(false);
    }
  }, [load]);

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);

  return { posts, loading, error, hasMore, loadMore, refresh };
}
