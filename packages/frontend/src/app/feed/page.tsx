'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/contexts/WalletContext';
import { getFollowing, getPostsByAuthor, getPost, getProfile, Post, Profile } from '@/lib/contract';

export default function FeedPage() {
  const router = useRouter();
  const { isConnected, publicKey } = useWallet();
  const [posts, setPosts] = useState<Post[]>([]);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const POSTS_PER_PAGE = 10;

  useEffect(() => {
    if (!isConnected) {
      router.push('/');
      return;
    }
    loadFeed();
  }, [isConnected, publicKey]);

  const loadFeed = async () => {
    if (!publicKey) return;

    setIsLoading(true);
    setError(null);

    try {
      // Get list of followed accounts
      const following = await getFollowing(publicKey);
      
      if (following.length === 0) {
        setPosts([]);
        setProfiles(new Map());
        setIsLoading(false);
        return;
      }

      // Get post IDs for each followed account
      const allPostIds: number[] = [];
      const postIdsByAuthor: Map<string, number[]> = new Map();

      for (const author of following) {
        const postIds = await getPostsByAuthor(author);
        postIdsByAuthor.set(author, postIds);
        allPostIds.push(...postIds);
      }

      if (allPostIds.length === 0) {
        setPosts([]);
        setProfiles(new Map());
        setIsLoading(false);
        return;
      }

      // Fetch all posts
      const fetchedPosts: Post[] = [];
      for (const postId of allPostIds) {
        const post = await getPost(postId);
        if (post) {
          fetchedPosts.push(post);
        }
      }

      // Sort by timestamp descending
      fetchedPosts.sort((a, b) => b.timestamp - a.timestamp);

      // Fetch profiles for authors
      const profileMap = new Map<string, Profile>();
      for (const author of following) {
        const profile = await getProfile(author);
        if (profile) {
          profileMap.set(author, profile);
        }
      }

      setPosts(fetchedPosts);
      setProfiles(profileMap);
    } catch (err) {
      setError('Failed to load feed. Please try again.');
      console.error('Error loading feed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMore = () => {
    setPage((prev) => prev + 1);
  };

  const displayedPosts = posts.slice(0, page * POSTS_PER_PAGE);
  const hasMorePosts = displayedPosts.length < posts.length;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading your feed...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={loadFeed}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">📭</div>
          <h2 className="text-2xl font-semibold mb-2">No posts yet</h2>
          <p className="text-gray-600">
            {profiles.size === 0
              ? "You're not following anyone yet. Follow some accounts to see their posts here."
              : "The accounts you follow haven't posted anything yet."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-2xl mx-auto px-4">
        <h1 className="text-3xl font-bold mb-6">Your Feed</h1>
        
        <div className="space-y-4">
          {displayedPosts.map((post) => {
            const profile = profiles.get(post.author);
            return (
              <div
                key={post.id}
                className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-center mb-4">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold">
                    {profile?.username?.charAt(0).toUpperCase() || '?'}
                  </div>
                  <div className="ml-3">
                    <p className="font-semibold text-gray-900">
                      {profile?.username || post.author.slice(0, 8) + '...'}
                    </p>
                    <p className="text-sm text-gray-500">
                      {new Date(post.timestamp * 1000).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                
                <p className="text-gray-800 mb-4 whitespace-pre-wrap">{post.content}</p>
                
                <div className="flex items-center justify-between text-sm text-gray-500">
                  <div className="flex items-center space-x-4">
                    <span className="flex items-center">
                      <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" />
                      </svg>
                      {post.like_count}
                    </span>
                    <span className="flex items-center">
                      <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
                      </svg>
                      {post.tip_total}
                    </span>
                  </div>
                  <span className="text-gray-400">#{post.id}</span>
                </div>
              </div>
            );
          })}
        </div>

        {hasMorePosts && (
          <div className="mt-6 text-center">
            <button
              onClick={loadMore}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Load More
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
