"use client";

import React, { useState } from "react";

export interface PostItem {
  id: string;
  author: string;
  handle: string;
  verified: boolean;
  avatarBg: string;
  time: string;
  content: string;
  likes: number;
  comments: number;
  shares: number;
}

const mockPosts: PostItem[] = [
  {
    id: "1",
    author: "Alex Rivera",
    handle: "@7CAI.326",
    verified: true,
    avatarBg: "#60A5FA",
    time: "2h ago",
    content:
      "Just deployed our new Soroban smart contract for decentralized social tipping on Stellar testnet! 🚀 Feedback welcome from the developer community.",
    likes: 142,
    comments: 29,
    shares: 18,
  },
  {
    id: "2",
    author: "Sarah Lin",
    handle: "@sarah.web3",
    verified: true,
    avatarBg: "#818CF8",
    time: "4h ago",
    content:
      "Exploring the dark mode dashboard layout. Clean typography, smooth transitions, and responsive grid layouts make all the difference for UX.",
    likes: 98,
    comments: 12,
    shares: 7,
  },
  {
    id: "3",
    author: "Dev Jaja",
    handle: "@devjaja",
    verified: true,
    avatarBg: "#34D399",
    time: "5h ago",
    content:
      "Building three-column desktop dashboards with CSS grid and collapsible navigation. Accessibility and color contrast are top priorities!",
    likes: 215,
    comments: 44,
    shares: 31,
  },
  {
    id: "4",
    author: "Michael Scott",
    handle: "@mscott.stellar",
    verified: false,
    avatarBg: "#F59E0B",
    time: "6h ago",
    content:
      "Decentralized identity protocols are evolving rapidly. Storing credentials directly on Soroban state maps gives users true sovereignty over their graph data.",
    likes: 87,
    comments: 15,
    shares: 9,
  },
  {
    id: "5",
    author: "Elena Rostova",
    handle: "@elena.sor",
    verified: true,
    avatarBg: "#EC4899",
    time: "8h ago",
    content:
      "Masonry grids keep dynamic post lengths visually engaging. Excited to launch our next community pool build next week!",
    likes: 312,
    comments: 67,
    shares: 45,
  },
  {
    id: "6",
    author: "David Kim",
    handle: "@dkim_dev",
    verified: false,
    avatarBg: "#A78BFA",
    time: "12h ago",
    content:
      "Theme system with CSS custom properties allows instant toggling between dark navy (#0B1120) and crisp light theme tokens.",
    likes: 76,
    comments: 8,
    shares: 4,
  },
];

interface DashboardPostGridProps {
  isLoading?: boolean;
}

export function DashboardPostGrid({ isLoading = false }: DashboardPostGridProps) {
  const [likedPosts, setLikedPosts] = useState<Record<string, boolean>>({});
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>(
    mockPosts.reduce((acc, p) => ({ ...acc, [p.id]: p.likes }), {})
  );

  const handleLike = (id: string) => {
    setLikedPosts((prev) => {
      const isLiked = !prev[id];
      setLikeCounts((counts) => ({
        ...counts,
        [id]: isLiked ? counts[id] + 1 : counts[id] - 1,
      }));
      return { ...prev, [id]: isLiked };
    });
  };

  if (isLoading) {
    return (
      <div className="dashboard-masonry-grid" style={{ padding: "24px" }}>
        {[1, 2, 3, 4, 5, 6].map((idx) => (
          <div key={idx} className="dashboard-post-card skeleton-card">
            <div
              style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "14px" }}
            >
              <div className="skeleton-avatar" />
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                <div className="skeleton-line" style={{ width: "40%" }} />
                <div className="skeleton-line" style={{ width: "25%" }} />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div className="skeleton-line" style={{ width: "90%" }} />
              <div className="skeleton-line" style={{ width: "80%" }} />
              <div className="skeleton-line" style={{ width: "60%" }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="dashboard-masonry-grid" style={{ padding: "24px" }}>
      {mockPosts.map((post) => {
        const isLiked = !!likedPosts[post.id];
        const currentLikes = likeCounts[post.id];

        return (
          <article
            key={post.id}
            className="dashboard-post-card"
            style={{
              backgroundColor: "var(--bg-card, #1E293B)",
              borderRadius: "16px",
              border: "1px solid var(--border, #334155)",
              padding: "20px",
              marginBottom: "20px",
              breakInside: "avoid",
              transition: "transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease",
            }}
          >
            {/* Post Header: Avatar + Username + Handle + Verified + Options */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: "12px",
              }}
            >
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                <div
                  style={{
                    width: "42px",
                    height: "42px",
                    borderRadius: "50%",
                    backgroundColor: post.avatarBg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#FFFFFF",
                    fontWeight: 700,
                    fontSize: "1rem",
                    flexShrink: 0,
                  }}
                >
                  {post.author.charAt(0)}
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span
                      style={{
                        color: "var(--text-primary, #F8FAFC)",
                        fontWeight: 700,
                        fontSize: "0.95rem",
                      }}
                    >
                      {post.author}
                    </span>
                    {post.verified && (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="var(--accent-primary, #60A5FA)"
                      >
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                      </svg>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <span style={{ color: "var(--text-secondary, #94A3B8)", fontSize: "0.8rem" }}>
                      {post.handle}
                    </span>
                    <span style={{ color: "var(--border, #334155)" }}>•</span>
                    <span style={{ color: "var(--text-secondary, #94A3B8)", fontSize: "0.8rem" }}>
                      {post.time}
                    </span>
                  </div>
                </div>
              </div>

              {/* Three Dots More Options Menu */}
              <button
                aria-label="More options"
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--text-secondary, #94A3B8)",
                  cursor: "pointer",
                  padding: "4px 8px",
                  borderRadius: "6px",
                  fontSize: "1.2rem",
                }}
              >
                •••
              </button>
            </div>

            {/* Post Content */}
            <p
              style={{
                margin: "0 0 16px 0",
                color: "var(--text-primary, #F8FAFC)",
                fontSize: "0.95rem",
                lineHeight: 1.5,
              }}
            >
              {post.content}
            </p>

            {/* Action Buttons: Like, Comment, Share */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                paddingTop: "12px",
                borderTop: "1px solid var(--border, #334155)",
              }}
            >
              <button
                onClick={() => handleLike(post.id)}
                aria-label={`Like post, current likes ${currentLikes}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  border: "none",
                  background: "transparent",
                  color: isLiked ? "#EF4444" : "var(--text-secondary, #94A3B8)",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "color 0.2s ease",
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill={isLiked ? "#EF4444" : "none"}
                  stroke={isLiked ? "#EF4444" : "currentColor"}
                  strokeWidth="2"
                >
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
                <span>{currentLikes}</span>
              </button>

              <button
                aria-label={`Comments ${post.comments}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  border: "none",
                  background: "transparent",
                  color: "var(--text-secondary, #94A3B8)",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
                <span>{post.comments}</span>
              </button>

              <button
                aria-label={`Shares ${post.shares}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  border: "none",
                  background: "transparent",
                  color: "var(--text-secondary, #94A3B8)",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
                <span>{post.shares}</span>
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
