import Link from "next/link";
import type { CSSProperties } from "react";

export default function NotFound() {
  return (
    <main style={styles.main}>
      <div style={styles.card}>
        <div style={styles.icon} aria-hidden="true">
          🧭
        </div>
        <h1 style={styles.title}>404</h1>
        <p style={styles.text}>
          We couldn&apos;t find the page you were looking for. It may have been moved or
          never existed.
        </p>
        <Link href="/feed" style={styles.link}>
          Back to Feed
        </Link>
      </div>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  main: {
    minHeight: "calc(100vh - 73px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "var(--spacing-xl)",
  },
  card: {
    maxWidth: "420px",
    width: "100%",
    textAlign: "center",
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "16px",
    padding: "var(--spacing-xl)",
  },
  icon: {
    fontSize: "3rem",
    marginBottom: "var(--spacing-md)",
  },
  title: {
    fontSize: "2.5rem",
    fontWeight: 800,
    color: "var(--color-primary)",
    marginBottom: "var(--spacing-sm)",
    letterSpacing: "-0.03em",
  },
  text: {
    color: "var(--color-text-secondary)",
    lineHeight: 1.6,
    marginBottom: "var(--spacing-lg)",
  },
  link: {
    display: "inline-block",
    padding: "var(--spacing-sm) var(--spacing-xl)",
    background: "var(--color-primary)",
    color: "white",
    borderRadius: "8px",
    fontWeight: 600,
    textDecoration: "none",
    minHeight: "var(--min-touch-target)",
    lineHeight: "var(--min-touch-target)",
  },
};
