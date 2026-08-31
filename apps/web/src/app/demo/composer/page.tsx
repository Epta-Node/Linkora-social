"use client";

import { RichTextComposer } from "@/components/RichTextComposer";
import { useState } from "react";

export default function ComposerDemoPage() {
  const [submittedPosts, setSubmittedPosts] = useState<Array<{ content: string; timestamp: Date }>>([]);

  const mockUsers = [
    { id: "1", username: "alice", displayName: "Alice Johnson" },
    { id: "2", username: "bob", displayName: "Bob Smith" },
    { id: "3", username: "charlie", displayName: "Charlie Davis" },
    { id: "4", username: "diana", displayName: "Diana Prince" },
    { id: "5", username: "evan", displayName: "Evan Wright" },
  ];

  const handleSubmit = async (content: string, attachments?: File[], poll?: any[]) => {
    console.log("Submitted:", { content, attachments, poll });
    setSubmittedPosts((prev) => [...prev, { content, timestamp: new Date() }]);
  };

  return (
    <div className="min-h-screen bg-[var(--background)] p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
          Rich Text Composer Demo
        </h1>
        <p className="text-[var(--text-muted)] mb-8">
          Test the new rich text composer with mentions, hashtags, attachments, and polls.
        </p>

        <div className="mb-8">
          <RichTextComposer
            onSubmit={handleSubmit}
            placeholder="What's happening? Try typing @ to mention users or # for hashtags!"
            users={mockUsers}
          />
        </div>

        {submittedPosts.length > 0 && (
          <div>
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">
              Submitted Posts ({submittedPosts.length})
            </h2>
            <div className="space-y-4">
              {submittedPosts.map((post, index) => (
                <div
                  key={index}
                  className="bg-[var(--muted)] border border-[var(--border)] rounded-xl p-4"
                >
                  <div className="text-sm text-[var(--text-muted)] mb-2">
                    {post.timestamp.toLocaleString()}
                  </div>
                  <div className="text-[var(--text-primary)] whitespace-pre-wrap">{post.content}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
