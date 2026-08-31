import type { CSSProperties } from "react";

export function PostCardSkeleton() {
  return (
    <article style={styles.card} data-testid="post-card-skeleton">
      <div style={styles.header}>
        <div style={styles.avatar} />
        <div style={styles.meta}>
          <div style={{ ...styles.line, width: "40%" }} />
          <div style={{ ...styles.line, height: "10px", width: "25%", marginTop: "6px" }} />
        </div>
      </div>
      <div style={{ ...styles.line, width: "100%", marginTop: "var(--spacing-md)" }} />
      <div style={{ ...styles.line, width: "82%", marginTop: "var(--spacing-sm)" }} />
      <div style={styles.footer}>
        <div style={{ ...styles.chip, width: "72px" }} />
        <div style={{ ...styles.chip, width: "96px" }} />
      </div>
    </article>
  );
}

const shimmerBackground =
  "linear-gradient(90deg, var(--color-bg-secondary) 0%, var(--color-border) 50%, var(--color-bg-secondary) 100%)";

const styles: Record<string, CSSProperties> = {
  card: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    padding: "var(--spacing-lg)",
    marginBottom: "var(--spacing-md)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-sm)",
  },
  avatar: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    flexShrink: 0,
    background: shimmerBackground,
    backgroundSize: "200% 100%",
    animation: "shimmer 1.5s infinite",
  },
  meta: {
    flex: 1,
  },
  line: {
    height: "12px",
    borderRadius: "9999px",
    background: shimmerBackground,
    backgroundSize: "200% 100%",
    animation: "shimmer 1.5s infinite",
  },
  footer: {
    display: "flex",
    gap: "var(--spacing-sm)",
    marginTop: "var(--spacing-md)",
  },
  chip: {
    height: "24px",
    borderRadius: "9999px",
    background: shimmerBackground,
    backgroundSize: "200% 100%",
    animation: "shimmer 1.5s infinite",
  },
};
