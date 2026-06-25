"use client";

import Link from "next/link";
import { useState } from "react";

export interface ProfileHeaderProps {
  address: string;
  username: string;
  creatorToken: string;
  followerCount: number;
  followingCount: number;
  isOwnProfile: boolean;
  followState: "not_following" | "following" | "loading" | "blocked";
  onFollow: () => void;
  onUnfollow: () => void;
}

function formatAddress(addr: string) {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      style={styles.copyBtn}
      aria-label="Copy address"
      title={text}
    >
      {copied ? "✓" : "⎘"}
    </button>
  );
}

function FollowButton({
  state,
  onFollow,
  onUnfollow,
}: Pick<ProfileHeaderProps, "onFollow" | "onUnfollow"> & {
  state: ProfileHeaderProps["followState"];
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
        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).textContent = "Unfollow")}
        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).textContent = "Following")}
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

export function ProfileHeader({
  address,
  username,
  creatorToken,
  followerCount,
  followingCount,
  isOwnProfile,
  followState,
  onFollow,
  onUnfollow,
}: ProfileHeaderProps) {
  return (
    <section style={styles.header}>
      <div style={styles.avatarLg} aria-hidden="true" />

      <div style={styles.meta}>
        <div style={styles.usernameRow}>
          <h1 style={styles.username}>@{username}</h1>
          {isOwnProfile && (
            <Link href={`/profile/${address}/edit`} style={styles.editLink}>
              Edit profile
            </Link>
          )}
        </div>

        <div style={styles.addressRow}>
          <code style={styles.address}>{formatAddress(address)}</code>
          <CopyButton text={address} />
        </div>

        <span style={styles.badge} title={creatorToken}>
          🪙 {formatAddress(creatorToken)}
        </span>

        <div style={styles.statsRow}>
          <Link href={`/profile/${address}/followers`} style={styles.statLink}>
            <strong>{followerCount}</strong>
            <span style={styles.statLabel}> Followers</span>
          </Link>
          <Link href={`/profile/${address}/following`} style={styles.statLink}>
            <strong>{followingCount}</strong>
            <span style={styles.statLabel}> Following</span>
          </Link>
        </div>
      </div>

      {!isOwnProfile && (
        <div style={styles.actions}>
          <FollowButton state={followState} onFollow={onFollow} onUnfollow={onUnfollow} />
        </div>
      )}
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
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
    margin: 0,
  },
  editLink: {
    fontSize: "0.85rem",
    fontWeight: 600,
    color: "var(--color-primary)",
    border: "1px solid var(--color-primary)",
    borderRadius: "8px",
    padding: "4px 12px",
    textDecoration: "none",
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
  statLink: {
    fontSize: "0.9rem",
    color: "var(--color-text)",
    textDecoration: "none",
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
    border: "none",
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
};
