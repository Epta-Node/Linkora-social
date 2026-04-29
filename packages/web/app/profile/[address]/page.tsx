"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { PostCard, Post } from "../../components/PostCard";

// In a real app this comes from a wallet context / auth hook.
const MOCK_CURRENT_USER = "";

interface Profile {
  address: string;
  username: string;
  creator_token: string;
  follower_count: number;
  following_count: number;
}

type FollowState = "not_following" | "following" | "loading" | "blocked";

function formatAddress(addr: string) {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function CreatorTokenBadge({ token }: { token: string }) {
  return (
    <span style={styles.badge} title={token}>
      🪙 {formatAddress(token)}
    </span>
  );
}

function FollowButton({
  state,
  onFollow,
  onUnfollow,
}: {
  state: FollowState;
  onFollow: () => void;
  onUnfollow: () => void;
}) {
  if (state === "blocked") {
    return (
      <button disabled style={{ ...styles.followBtn, ...styles.blockedBtn }}>
        Blocked
      </button>
    );
  }
  if (state === "loading") {
    return (
      <button disabled style={{ ...styles.followBtn, ...styles.loadingBtn }}>
        <span style={styles.spinner} />
      </button>
    );
  }
  if (state === "following") {
    return (
      <button
        onClick={onUnfollow}
        style={{ ...styles.followBtn, ...styles.followingBtn }}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLButtonElement).textContent = "Unfollow")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLButtonElement).textContent = "Following")
        }
      >
        Following
      </button>
    );
  }
  return (
    <button onClick={onFollow} style={styles.followBtn}>
      Follow
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      onClick={handleCopy}
      style={styles.copyBtn}
      aria-label="Copy address"
      title={text}
    >
      {copied ? "✓" : "⎘"}
    </button>
  );
}

export default function ProfilePage() {
  const params = useParams();
  const address = params?.address as string;

  const isOwnProfile =
    MOCK_CURRENT_USER !== "" && MOCK_CURRENT_USER === address;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [likedPosts, setLikedPosts] = useState<Set<number>>(new Set());
  const [followState, setFollowState] = useState<FollowState>("not_following");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setLoading(true);
    setNotFound(false);

    // Mock data — replace with real contract calls.
    setTimeout(() => {
      if (!address) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setProfile({
        address,
        username: "creator_alice",
        creator_token: "GABCDEF1234567890ABCDEF1234567890ABCDEF1",
        follower_count: 142,
        following_count: 38,
      });
      setPosts([
        {
          id: 1,
          author: address,
          username: "creator_alice",
          content: "Just launched my creator token on Linkora! 🎉 Excited to build something real here.",
          tip_total: 120_000_000,
          timestamp: Date.now() / 1000 - 7200,
          like_count: 31,
        },
        {
          id: 2,
          author: address,
          username: "creator_alice",
          content: "The Stellar network makes micropayments actually viable for creator economies.",
          tip_total: 45_000_000,
          timestamp: Date.now() / 1000 - 86_400,
          like_count: 18,
        },
      ]);
      setLoading(false);
    }, 400);
  }, [address]);

  const handleFollow = useCallback(() => {
    setFollowState("loading");
    setTimeout(() => setFollowState("following"), 600);
  }, []);

  const handleUnfollow = useCallback(() => {
    setFollowState("loading");
    setTimeout(() => setFollowState("not_following"), 600);
  }, []);

  const handleLike = useCallback((postId: number) => {
    setLikedPosts((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? { ...p, like_count: p.like_count + (likedPosts.has(postId) ? -1 : 1) }
          : p
      )
    );
  }, [likedPosts]);

  if (loading) {
    return (
      <main style={styles.page}>
        <div style={styles.skeletonHeader} />
        <div style={styles.skeletonBody} />
        <div style={styles.skeletonBody} />
      </main>
    );
  }

  if (notFound || !profile) {
    return (
      <main style={styles.page}>
        <div style={styles.emptyState}>
          <p style={styles.emptyTitle}>Profile not found</p>
          <p style={styles.emptyDesc}>
            No profile exists for this address, or it may have been removed.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      {/* ── Profile header ─────────────────────────────────────────────── */}
      <section style={styles.header}>
        <div style={styles.avatarLg} aria-hidden="true" />

        <div style={styles.meta}>
          <div style={styles.usernameRow}>
            <h1 style={styles.username}>@{profile.username}</h1>
            {isOwnProfile && (
              <a href={`/profile/${address}/edit`} style={styles.editLink}>
                Edit profile
              </a>
            )}
          </div>

          <div style={styles.addressRow}>
            <code style={styles.address}>{formatAddress(profile.address)}</code>
            <CopyButton text={profile.address} />
          </div>

          <CreatorTokenBadge token={profile.creator_token} />

          <div style={styles.statsRow}>
            <span style={styles.stat}>
              <strong>{profile.follower_count}</strong>
              <span style={styles.statLabel}> Followers</span>
            </span>
            <span style={styles.stat}>
              <strong>{profile.following_count}</strong>
              <span style={styles.statLabel}> Following</span>
            </span>
          </div>
        </div>

        {!isOwnProfile && (
          <div style={styles.actions}>
            <FollowButton
              state={followState}
              onFollow={handleFollow}
              onUnfollow={handleUnfollow}
            />
          </div>
        )}
      </section>

      {/* ── Post list ──────────────────────────────────────────────────── */}
      <section>
        <h2 style={styles.sectionTitle}>Posts</h2>
        {posts.length === 0 ? (
          <div style={styles.emptyState}>
            <p style={styles.emptyTitle}>No posts yet</p>
            <p style={styles.emptyDesc}>
              {isOwnProfile
                ? "You haven't posted anything yet. Share something with the world!"
                : `${profile.username} hasn't posted yet.`}
            </p>
          </div>
        ) : (
          posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onLike={handleLike}
              isLiked={likedPosts.has(post.id)}
            />
          ))
        )}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: "640px",
    margin: "0 auto",
    padding: "var(--spacing-lg)",
    minHeight: "100vh",
    background: "var(--color-bg-secondary)",
  },
  header: {
    display: "flex",
    gap: "var(--spacing-lg)",
    alignItems: "flex-start",
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    padding: "var(--spacing-lg)",
    marginBottom: "var(--spacing-lg)",
    flexWrap: "wrap",
  },
  avatarLg: {
    width: "72px",
    height: "72px",
    borderRadius: "50%",
    background: "var(--color-bg-secondary)",
    flexShrink: 0,
    border: "2px solid var(--color-border)",
  },
  meta: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-sm)",
  },
  usernameRow: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-md)",
    flexWrap: "wrap",
  },
  username: {
    fontSize: "1.3rem",
    fontWeight: 700,
    color: "var(--color-text)",
  },
  editLink: {
    fontSize: "0.85rem",
    fontWeight: 600,
    color: "var(--color-primary)",
    border: "1px solid var(--color-primary)",
    borderRadius: "8px",
    padding: "4px 12px",
    textDecoration: "none",
    minHeight: "var(--min-touch-target)",
    display: "inline-flex",
    alignItems: "center",
  },
  addressRow: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-xs)",
  },
  address: {
    fontSize: "0.8rem",
    color: "var(--color-text-secondary)",
    fontFamily: "monospace",
  },
  copyBtn: {
    fontSize: "0.85rem",
    padding: "2px 6px",
    borderRadius: "4px",
    background: "var(--color-bg-secondary)",
    color: "var(--color-text-secondary)",
    minHeight: "auto",
    minWidth: "auto",
    cursor: "pointer",
    border: "1px solid var(--color-border)",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "0.75rem",
    fontWeight: 600,
    padding: "3px 10px",
    borderRadius: "99px",
    background: "var(--color-bg-secondary)",
    border: "1px solid var(--color-border)",
    color: "var(--color-text-secondary)",
    width: "fit-content",
  },
  statsRow: {
    display: "flex",
    gap: "var(--spacing-lg)",
    marginTop: "var(--spacing-xs)",
  },
  stat: {
    fontSize: "0.9rem",
    color: "var(--color-text)",
  },
  statLabel: {
    color: "var(--color-text-secondary)",
    fontWeight: 400,
  },
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-sm)",
    alignSelf: "flex-start",
  },
  followBtn: {
    padding: "var(--spacing-sm) var(--spacing-lg)",
    background: "var(--color-primary)",
    color: "white",
    borderRadius: "8px",
    fontWeight: 600,
    minHeight: "var(--min-touch-target)",
    minWidth: "100px",
    cursor: "pointer",
    transition: "background 0.15s",
  },
  followingBtn: {
    background: "var(--color-bg-secondary)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
  },
  loadingBtn: {
    background: "var(--color-bg-secondary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  blockedBtn: {
    background: "var(--color-bg-secondary)",
    color: "var(--color-text-secondary)",
    cursor: "not-allowed",
    opacity: 0.6,
  },
  spinner: {
    display: "inline-block",
    width: "16px",
    height: "16px",
    border: "2px solid var(--color-border)",
    borderTopColor: "var(--color-primary)",
    borderRadius: "50%",
    animation: "spin 0.7s linear infinite",
  },
  sectionTitle: {
    fontSize: "1rem",
    fontWeight: 700,
    marginBottom: "var(--spacing-md)",
    color: "var(--color-text)",
  },
  emptyState: {
    textAlign: "center",
    padding: "var(--spacing-xl)",
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
  },
  emptyTitle: {
    fontWeight: 600,
    marginBottom: "var(--spacing-sm)",
    fontSize: "1rem",
  },
  emptyDesc: {
    color: "var(--color-text-secondary)",
    fontSize: "0.9rem",
  },
  skeletonHeader: {
    height: "140px",
    borderRadius: "12px",
    background: "var(--color-bg-secondary)",
    marginBottom: "var(--spacing-lg)",
    animation: "skeleton-shimmer 1.4s ease-in-out infinite",
  },
  skeletonBody: {
    height: "100px",
    borderRadius: "12px",
    background: "var(--color-bg-secondary)",
    marginBottom: "var(--spacing-md)",
    animation: "skeleton-shimmer 1.4s ease-in-out infinite",
  },
};
