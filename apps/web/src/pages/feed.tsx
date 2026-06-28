import { useEffect, useState } from "react";
import { PostCardSkeleton } from "../components/ui/Skeletons";

function FeedPage() {
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    // Mimicking layout API retrieval sequence
    const timer = setTimeout(() => {
      setPosts([
        /* Mock loaded posts data arrays */
      ]);
      setLoading(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="mx-auto max-w-xl px-4 py-6">
      <h1 className="mb-4 text-xl font-bold text-gray-900 dark:text-white">Your Feed</h1>

      {loading ? (
        <>
          <PostCardSkeleton />
          <PostCardSkeleton />
          <PostCardSkeleton />
        </>
      ) : (
        <div>
          {posts.map((post) => (
            <div key={post.id}>{/* Actual active component wrapper logic */}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default FeedPage;
