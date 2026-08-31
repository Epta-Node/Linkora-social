'use client';

import { useState } from 'react';
import { validatePostContent, sanitisePostContent, POST_MAX_CHARS } from '@/lib/validate';
import { FieldError } from './FieldError';

interface PostFormProps {
  /** Called with sanitised content when the form is valid and submitted. */
  onSubmit: (content: string) => void | Promise<void>;
  disabled?: boolean;
}

export function PostForm({ onSubmit, disabled = false }: PostFormProps) {
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const remaining = POST_MAX_CHARS - content.length;
  const overLimit = remaining < 0;

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value);
    // Clear error as user types
    if (error) setError(undefined);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sanitised = sanitisePostContent(content);
    const result = validatePostContent(sanitised);
    if (!result.valid) {
      setError(result.error);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(sanitised);
      setContent('');
      setError(undefined);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Create post">
      <div className="flex flex-col gap-2">
        <label htmlFor="post-content" className="font-medium text-sm">
          What&apos;s on your mind?
        </label>
        <textarea
          id="post-content"
          name="content"
          value={content}
          onChange={handleChange}
          rows={4}
          maxLength={POST_MAX_CHARS + 50} // soft cap; hard validation below
          disabled={disabled || submitting}
          aria-describedby={error ? 'post-content-error' : undefined}
          aria-invalid={!!error}
          className={`w-full rounded-lg border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 ${
            error ? 'border-red-500' : 'border-gray-300'
          }`}
          placeholder="Share something with the Linkora community…"
        />
        <div className="flex items-center justify-between">
          <FieldError id="post-content-error" message={error} />
          <span
            className={`text-xs ml-auto ${
              overLimit ? 'text-red-600 font-semibold' : remaining <= 20 ? 'text-yellow-600' : 'text-gray-400'
            }`}
            aria-live="polite"
            aria-label={`${remaining} characters remaining`}
          >
            {remaining}
          </span>
        </div>
        <button
          type="submit"
          disabled={disabled || submitting || overLimit}
          className="self-end px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Posting…' : 'Post'}
        </button>
      </div>
    </form>
  );
}
