'use client';

import { useState } from 'react';
import SearchBar from '../../components/SearchBar';

interface Post {
  id: string;
  author: string;
  content: string;
  tip_total: string;
  timestamp: string;
}

interface SearchResponse {
  posts: Post[];
  total: number;
  has_more: boolean;
}

export default function ExplorePage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (query: string) => {
    setLoading(true);
    setError(null);

    try {
      // TODO: Replace with actual indexer API URL
      const INDEXER_API_URL = 'http://localhost:3001';
      
      const response = await fetch(`${INDEXER_API_URL}/api/search/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          limit: 20,
          offset: 0,
        }),
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }

      const data: SearchResponse = await response.json();
      setPosts(data.posts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setPosts([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Explore Posts</h1>
      
      <div className="mb-8">
        <SearchBar onSearch={handleSearch} />
      </div>

      {loading && (
        <div className="text-center py-8">
          <div className="text-gray-600">Searching posts...</div>
        </div>
      )}

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {posts.length > 0 && (
        <div className="space-y-4">
          {posts.map((post) => (
            <div key={post.id} className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <div className="text-sm text-gray-600">
                  By: {post.author}
                </div>
                <div className="text-sm text-gray-500">
                  {new Date(parseInt(post.timestamp) * 1000).toLocaleDateString()}
                </div>
              </div>
              <div className="text-gray-900 mb-2">{post.content}</div>
              <div className="text-sm text-gray-600">
                Tips: {post.tip_total}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && posts.length === 0 && (
        <div className="text-center py-8 text-gray-600">
          Enter a search query to find posts
        </div>
      )}
    </div>
  );
}
