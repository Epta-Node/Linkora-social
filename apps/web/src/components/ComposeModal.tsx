'use client';

import { useState, useCallback } from 'react';
import { submitPost, CreatePostPayload, CreatePostResult, PollData } from './CreatePost';

export interface ComposeModalProps {
  isOpen: boolean;
  authorAddress?: string;
  onClose: () => void;
  onSuccess?: (postId: number) => void;
  submitFn?: (payload: CreatePostPayload) => Promise<CreatePostResult>;
}

export function ComposeModal({
  isOpen,
  authorAddress,
  onClose,
  onSuccess,
  submitFn = submitPost,
}: ComposeModalProps) {
  const [content, setContent] = useState('');
  const [poll, setPoll] = useState<PollData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

        setContent('');
        setPoll(null);

        if (onSuccess) {
          onSuccess(result.id);
        }
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to publish post');
      } finally {
        setSubmitting(false);
      }
    },
    [content, submitting, authorAddress, poll, submitFn, onSuccess, onClose]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-lg w-full p-6 shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-900">Compose Post</h2>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-gray-500 hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Share an update on-chain..."
            disabled={submitting}
            className="w-full border border-gray-300 rounded-md p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 mb-4"
            rows={4}
          />

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-md mb-4">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!content.trim() || submitting || !authorAddress}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-md"
            >
              {submitting ? 'Publishing...' : 'Publish'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
