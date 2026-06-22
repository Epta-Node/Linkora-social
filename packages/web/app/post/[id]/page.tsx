'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useWallet } from '../../components/WalletProvider';
import { TipModal } from '../../components/TipModal';
import { useLike } from '../../hooks/useLike';
import Link from 'next/link';

interface PostData {
  id: number;
  author: string;
  content: string;
  tipTotal: bigint;
  likeCount: number;
  timestamp: bigint;
  hasLiked: boolean;
}

export default function PostDetailPage() {
  const params = useParams();
  const postId = Number(params.id);
  const { publicKey } = useWallet();

  const [post, setPost] = useState<PostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showTipModal, setShowTipModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const { liked, likeCount, pending, error, like } = useLike({
    postId,
    initialHasLiked: post?.hasLiked ?? false,
    initialLikeCount: post?.likeCount ?? 0,
  });

  useEffect(() => {
    async function fetchPost() {
      try {
        const res = await fetch('/api/posts/' + postId);
        if (!res.ok) throw new Error('not found');
        const data = await res.json();
        setPost(data);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    }
    if (postId) fetchPost();
  }, [postId]);

  const handleShare = useCallback(async () => {
    const url = window.location.href;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  if (loading) {
    return (
      <div style={{ maxWidth: '640px', margin: '0 auto', padding: '40px 20px' }}>
        <div style={{ background: '#1e293b', borderRadius: 16, padding: 24, animation: 'pulse 1.5s infinite' }}>
          <div style={{ width: '60%', height: 20, background: '#334155', borderRadius: 4, marginBottom: 12 }} />
          <div style={{ width: '100%', height: 16, background: '#334155', borderRadius: 4, marginBottom: 8 }} />
          <div style={{ width: '80%', height: 16, background: '#334155', borderRadius: 4 }} />
        </div>
      </div>
    );
  }

  if (notFound || !post) {
    return (
      <div style={{ maxWidth: '640px', margin: '80px auto', textAlign: 'center', padding: 40 }}>
        <h1 style={{ fontSize: 48, marginBottom: 8 }}>404</h1>
        <p style={{ color: '#94a3b8', fontSize: 18, marginBottom: 24 }}>This post has been deleted or does not exist.</p>
        <Link href="/feed" style={{ color: '#7c3aed', textDecoration: 'none', fontWeight: 600 }}>
          Back to Feed
        </Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', padding: '40px 20px' }}>
      <div style={{ background: '#1e293b', borderRadius: 16, padding: 24, border: '1px solid rgba(255,255,255,0.08)', marginBottom: 16 }}>
        <p style={{ fontSize: 18, color: '#f8fafc', lineHeight: 1.6, margin: '0 0 20px 0' }}>{post.content}</p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 16 }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg, #7c3aed, #a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 18 }}>
            {post.author.slice(0, 2).toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <Link href={'/profile/' + post.author} style={{ color: '#f8fafc', fontWeight: 600, textDecoration: 'none' }}>
              {post.author.slice(0, 8)}...{post.author.slice(-4)}
            </Link>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
              {new Date(Number(post.timestamp) * 1000).toLocaleDateString()}
            </p>
          </div>
          <button style={{ padding: '6px 14px', borderRadius: 20, background: '#7c3aed', color: '#fff', border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            Follow
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <button
            onClick={like}
            disabled={liked || pending}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 20,
              background: liked ? 'rgba(124,58,237,0.2)' : 'transparent',
              border: '1px solid ' + (liked ? '#7c3aed' : 'rgba(255,255,255,0.1)'),
              color: liked ? '#a78bfa' : '#94a3b8',
              cursor: liked || pending ? 'default' : 'pointer',
              fontSize: 14, fontWeight: 500,
              opacity: pending ? 0.7 : 1,
            }}
          >
            {liked ? '\u2665' : '\u2661'} {likeCount}
          </button>

          <button
            onClick={() => setShowTipModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 20, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}
          >
            Tip
          </button>

          <button
            onClick={handleShare}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 20, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: copied ? '#10b981' : '#94a3b8', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}
          >
            {copied ? 'Copied' : 'Share'}
          </button>
        </div>

        {error && <p style={{ color: '#f87171', fontSize: 13, marginTop: 8 }}>{error}</p>}
      </div>

      {showTipModal && (
        <TipModal
          postId={post.id}
          authorName={post.author.slice(0, 8) + '...' + post.author.slice(-4)}
          onClose={() => setShowTipModal(false)}
        />
      )}
    </div>
  );
}
