'use client'

import { useState, useEffect } from 'react'
import { getFollowing, getPostsByAuthor, getPost, getProfile } from '@/lib/contract'

interface Post {
  id: number
  author: string
  content: string
  tip_total: number
  timestamp: number
  like_count: number
}

interface Profile {
  address: string
  username: string
  creator_token: string
}

interface PostWithProfile extends Post {
  profile?: Profile
}

export default function FeedPage() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [posts, setPosts] = useState<PostWithProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)

  useEffect(() => {
    // Check for wallet connection
    const checkWallet = async () => {
      try {
        // @ts-ignore - Freighter API
        if (window.freighter) {
          // @ts-ignore
          const address = await window.freighter.getPublicKey()
          setWalletAddress(address)
        } else {
          setError('Freighter wallet not found. Please install Freighter extension.')
        }
      } catch (err) {
        setError('Failed to connect to wallet')
      }
      setLoading(false)
    }

    checkWallet()
  }, [])

  useEffect(() => {
    if (walletAddress) {
      loadFeed()
    }
  }, [walletAddress, page])

  const loadFeed = async () => {
    if (!walletAddress) return

    try {
      setLoading(true)
      const offset = page * 10
      const limit = 10

      // Get list of followed accounts
      const following = await getFollowing(walletAddress, offset, limit)

      if (following.length === 0 && page === 0) {
        setPosts([])
        setHasMore(false)
        setLoading(false)
        return
      }

      // Fetch posts from each followed account
      const allPosts: PostWithProfile[] = []
      for (const author of following) {
        const postIds = await getPostsByAuthor(author, 0, 10)
        for (const postId of postIds) {
          const post = await getPost(postId)
          if (post) {
            const profile = await getProfile(author)
            allPosts.push({ ...post, profile })
          }
        }
      }

      // Sort by timestamp descending
      allPosts.sort((a, b) => b.timestamp - a.timestamp)

      if (page === 0) {
        setPosts(allPosts)
      } else {
        setPosts(prev => [...prev, ...allPosts])
      }

      setHasMore(following.length >= limit)
    } catch (err) {
      setError('Failed to load feed')
    } finally {
      setLoading(false)
    }
  }

  const handleLoadMore = () => {
    setPage(prev => prev + 1)
  }

  if (loading && page === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center">
        <div className="text-white text-center">
          <p className="text-xl mb-4">{error}</p>
          <a href="/" className="text-blue-300 hover:underline">Go Home</a>
        </div>
      </div>
    )
  }

  if (!walletAddress) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center">
        <div className="text-white text-center">
          <p className="text-xl mb-4">Please connect your wallet to view the feed</p>
          <button
            onClick={async () => {
              try {
                // @ts-ignore
                if (window.freighter) {
                  // @ts-ignore
                  const address = await window.freighter.getPublicKey()
                  setWalletAddress(address)
                }
              } catch (err) {
                setError('Failed to connect wallet')
              }
            }}
            className="bg-white text-purple-900 font-semibold px-6 py-3 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Connect Wallet
          </button>
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-white">Following Feed</h1>
          <a href="/" className="text-blue-300 hover:underline">Home</a>
        </div>

        {posts.length === 0 && !loading ? (
          <div className="text-center text-white py-16">
            <p className="text-xl mb-2">No posts yet</p>
            <p className="text-gray-400">Follow some accounts to see their posts here</p>
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <div key={post.id} className="bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20">
                <div className="flex items-center mb-4">
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center text-white font-bold">
                    {post.profile?.username?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="ml-3">
                    <p className="text-white font-semibold">
                      {post.profile?.username || post.author.slice(0, 8)}
                    </p>
                    <p className="text-gray-400 text-sm">
                      {new Date(post.timestamp * 1000).toLocaleString()}
                    </p>
                  </div>
                </div>
                <p className="text-white text-lg mb-4">{post.content}</p>
                <div className="flex items-center space-x-4 text-gray-400">
                  <span>❤️ {post.like_count}</span>
                  <span>💰 {post.tip_total}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {hasMore && posts.length > 0 && (
          <div className="text-center mt-8">
            <button
              onClick={handleLoadMore}
              disabled={loading}
              className="bg-white/20 text-white font-semibold px-6 py-3 rounded-lg hover:bg-white/30 transition-colors disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Load More'}
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
