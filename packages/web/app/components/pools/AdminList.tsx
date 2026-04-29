"use client";

import type { CSSProperties } from "react";
import { truncateAddress, STELLAR_KEY_RE } from "../../hooks/usePools";
import { ThresholdBadge } from "./ThresholdBadge";

interface AdminListProps {
  admins: string[];
  threshold: number;
  currentUser?: string | null;
}

export function AdminList({ admins, threshold, currentUser }: AdminListProps) {
  const isCurrentUserAdmin = currentUser
    ? admins.some((a) => a === currentUser)
    : false;

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        <h3 style={styles.title}>Admins</h3>
        <ThresholdBadge threshold={threshold} total={admins.length} variant="compact" />
      </div>

      <div style={styles.thresholdFull}>
        <ThresholdBadge threshold={threshold} total={admins.length} variant="full" />
      </div>

      <ul style={styles.list} role="list" aria-label="Pool administrators">
        {admins.map((addr, i) => {
          const isYou = currentUser && addr === currentUser;
          const isValid = STELLAR_KEY_RE.test(addr);
          return (
            <li key={addr} style={styles.item}>
              <div style={styles.avatar} aria-hidden="true">
                {addr.slice(1, 3).toUpperCase()}
              </div>
              <div style={styles.addrBlock}>
                <span
                  style={{
                    ...styles.addr,
                    ...(isYou ? styles.addrYou : {}),
                  }}
                  title={addr}
                >
                  <span style={styles.addrMono}>{truncateAddress(addr)}</span>
                  {isYou && <span style={styles.youBadge}>You</span>}
                </span>
                {!isValid && (
                  <span style={styles.invalidBadge} role="alert">
                    Invalid key
                  </span>
                )}
              </div>
              <span style={styles.index} aria-label={`Admin ${i + 1}`}>
                #{i + 1}
              </span>
            </li>
          );
        })}
      </ul>

      {isCurrentUserAdmin && (
        <p style={styles.adminNote} role="status">
          ✓ You are an admin of this pool
        </p>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--space-2)",
  },
  title: {
    fontSize: "var(--text-base)",
    fontWeight: "var(--font-semibold)" as unknown as number,
    color: "var(--color-text-primary)",
    margin: 0,
  },
  thresholdFull: {
    padding: "var(--space-4)",
    background: "var(--color-surface-1)",
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--color-border)",
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-2)",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
    padding: "var(--space-3)",
    background: "var(--color-surface-1)",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--color-border)",
  },
  avatar: {
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    background: "var(--color-primary-light)",
    color: "var(--color-primary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.7rem",
    fontWeight: 700,
    flexShrink: 0,
    fontFamily: "var(--font-mono)",
  },
  addrBlock: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    minWidth: 0,
  },
  addr: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    minWidth: 0,
  },
  addrYou: {
    color: "var(--color-primary)",
  },
  addrMono: {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-sm)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  youBadge: {
    padding: "0.1rem 0.4rem",
    background: "var(--color-primary-light)",
    color: "var(--color-primary)",
    borderRadius: "9999px",
    fontSize: "0.7rem",
    fontWeight: 700,
    flexShrink: 0,
  },
  invalidBadge: {
    padding: "0.1rem 0.4rem",
    background: "var(--color-error-light)",
    color: "var(--color-error)",
    borderRadius: "9999px",
    fontSize: "0.7rem",
    fontWeight: 600,
    flexShrink: 0,
  },
  index: {
    fontSize: "0.75rem",
    color: "var(--color-text-secondary)",
    fontFamily: "var(--font-mono)",
    flexShrink: 0,
  },
  adminNote: {
    fontSize: "var(--text-sm)",
    color: "var(--color-success)",
    fontWeight: 500,
    margin: 0,
    padding: "var(--space-3)",
    background: "#D1FAE5",
    borderRadius: "var(--radius-md)",
  },
};
