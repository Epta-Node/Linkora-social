"use client";

interface Profile {
  address: string;
  username: string;
  followerCount: number;
  isFollowing?: boolean;
}

interface ProfileCardProps {
  profile: Profile;
  onFollow?: (address: string) => void;
  following?: boolean;
}

export function ProfileCard({
  profile,
  onFollow,
  following = false,
}: ProfileCardProps) {
  return (
    <div style={styles.card}>
      <div style={styles.avatar}></div>
      <div style={styles.info}>
        <div style={styles.username}>{profile.username}</div>
        <div style={styles.stats}>{profile.followerCount} followers</div>
      </div>
      {onFollow && (
        <button
          onClick={() => onFollow(profile.address)}
          style={{
            ...styles.followButton,
            ...(following ? styles.followingButton : {}),
          }}
        >
          {following ? "Following" : "Follow"}
        </button>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-md)",
    padding: "var(--spacing-md)",
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    marginBottom: "var(--spacing-sm)",
  },
  avatar: {
    width: "48px",
    height: "48px",
    borderRadius: "50%",
    background: "var(--color-bg-secondary)",
    flexShrink: 0,
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  username: {
    fontWeight: 600,
    fontSize: "0.95rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  stats: {
    fontSize: "0.85rem",
    color: "var(--color-text-secondary)",
  },
  followButton: {
    padding: "var(--spacing-sm) var(--spacing-lg)",
    background: "var(--color-primary)",
    color: "white",
    borderRadius: "8px",
    fontWeight: 600,
    minHeight: "var(--min-touch-target)",
    flexShrink: 0,
  },
  followingButton: {
    background: "var(--color-bg-secondary)",
    color: "var(--color-text)",
  },
};
