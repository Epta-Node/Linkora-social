'use client';

import { useState, useCallback } from 'react';

export interface PollOption {
  id: string;
  label: string;
  votes: number;
}

export interface PollData {
  question: string;
  options: PollOption[];
}

export interface CreatePostPayload {
  content: string;
  author: string;
  poll?: PollData | null;
}

export interface CreatePostResult {
  id: number;
  transactionHash?: string;
  timestamp: number;
}

export async function submitPost(payload: CreatePostPayload): Promise<CreatePostResult> {
  const INDEXER_API_URL = process.env.NEXT_PUBLIC_INDEXER_API_URL || 'http://localhost:3001';
  const response = await fetch(`${INDEXER_API_URL}/api/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to submit post: ${response.statusText}`);
  }

  const data = await response.json();
  if (typeof data.id !== 'number' && typeof data.id !== 'string') {
    throw new Error('Invalid response from post creation API');
  }

  return {
    id: Number(data.id),
    transactionHash: data.transactionHash,
    timestamp: data.timestamp || Date.now(),
  };
}

export interface CreatePostProps {
  authorAddress?: string;
  onSuccess?: (postId: number) => void;
  compact?: boolean;
  submitFn?: (payload: CreatePostPayload) => Promise<CreatePostResult>;
}

export function CreatePost({
  authorAddress,
  onSuccess,
  compact = false,
  submitFn = submitPost,
}: CreatePostProps) {
  const [content, setContent] = useState('');
  const [poll, setPoll] = useState<PollData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedPostId, setConfirmedPostId] = useState<number | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!content.trim() || submitting || !authorAddress) return;

      setSubmitting(true);
      setError(null);

      try {
        const result = await submitFn({
          content,
          author: authorAddress,
          poll,
        });

        setConfirmedPostId(result.id);
        setContent('');
        setPoll(null);

        if (onSuccess) {
          onSuccess(result.id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to publish post');
      } finally {
        setSubmitting(false);
      }
    },
    [content, submitting, authorAddress, poll, submitFn, onSuccess]
  );

  return (
    <form onSubmit={handleSubmit} className={`bg-white border border-gray-200 rounded-lg ${compact ? 'p-4' : 'p-6'} shadow-sm`}>
      <div className="mb-4">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What's on your mind?"
          disabled={submitting}
          className="w-full border border-gray-300 rounded-md p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          rows={compact ? 2 : 4}
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-md mb-4">
          {error}
        </div>
      )}

      {confirmedPostId && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm p-3 rounded-md mb-4">
          Post published successfully! Confirmed ID: #{confirmedPostId}
        </div>
      )}

      <div className="flex justify-between items-center">
        <span className="text-xs text-gray-500">
          {content.length}/280
        </span>
        <button
          type="submit"
          disabled={!content.trim() || submitting || !authorAddress}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-md text-sm"
        >
          {submitting ? 'Submitting...' : 'Post'}
        </button>
      </div>
    </form>
  );
}
