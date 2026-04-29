"use client";

import { useState, useCallback, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useWallet } from "../../components/WalletProvider";
import { useCreatePool } from "../../hooks/usePoolContract";
import { TxStatusBanner } from "../../components/pools/TxStatusBanner";
import { ThresholdBadge } from "../../components/pools/ThresholdBadge";
import { STELLAR_KEY_RE } from "../../hooks/usePools";

// ── Validation ────────────────────────────────────────────────────────────────

const POOL_ID_RE = /^[a-zA-Z0-9_]{1,9}$/;

function validatePoolId(val: string): string | null {
  if (!val.trim()) return "Pool ID is required";
  if (!POOL_ID_RE.test(val.trim()))
    return "Pool ID: 1–9 alphanumeric characters or underscores";
  return null;
}

function validateToken(val: string): string | null {
  if (!val.trim()) return "Token address is required";
  if (!STELLAR_KEY_RE.test(val.trim())) return "Invalid Stellar public key";
  return null;
}

function validateAdminKey(val: string): string | null {
  if (!val.trim()) return "Address is required";
  if (!STELLAR_KEY_RE.test(val.trim())) return "Invalid Stellar public key (G + 55 chars)";
  return null;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CreatePoolPage() {
  const router = useRouter();
  const { publicKey, isConnected } = useWallet();
  const { status, result, error, createPool, reset } = useCreatePool();

  const [poolId, setPoolId] = useState("");
  const [token, setToken] = useState("");
  const [admins, setAdmins] = useState<string[]>(publicKey ? [publicKey] : [""]);
  const [threshold, setThreshold] = useState(1);

  const [poolIdError, setPoolIdError] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [adminErrors, setAdminErrors] = useState<(string | null)[]>([null]);

  const isSubmitting = status !== "idle" && status !== "error" && status !== "success";

  // ── Admin list management ─────────────────────────────────────────────────

  const addAdmin = () => {
    setAdmins((prev) => [...prev, ""]);
    setAdminErrors((prev) => [...prev, null]);
    // Clamp threshold
    setThreshold((t) => Math.min(t, admins.length + 1));
  };

  const removeAdmin = (index: number) => {
    if (admins.length <= 1) return;
    const next = admins.filter((_, i) => i !== index);
    setAdmins(next);
    setAdminErrors((prev) => prev.filter((_, i) => i !== index));
    setThreshold((t) => Math.min(t, next.length));
  };

  const updateAdmin = (index: number, value: string) => {
    setAdmins((prev) => prev.map((a, i) => (i === index ? value : a)));
    if (adminErrors[index]) {
      setAdminErrors((prev) =>
        prev.map((e, i) => (i === index ? validateAdminKey(value) : e))
      );
    }
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!publicKey) return;

      const pidErr = validatePoolId(poolId);
      const tokErr = validateToken(token);
      const admErrs = admins.map(validateAdminKey);
      const hasDuplicates = new Set(admins.map((a) => a.trim())).size !== admins.length;

      setPoolIdError(pidErr);
      setTokenError(tokErr);
      setAdminErrors(admErrs);

      if (pidErr || tokErr || admErrs.some(Boolean) || hasDuplicates) {
        if (hasDuplicates) {
          setAdminErrors((prev) =>
            prev.map((e, i) => {
              const addr = admins[i].trim();
              const isDup = admins.filter((a) => a.trim() === addr).length > 1;
              return isDup ? "Duplicate address" : e;
            })
          );
        }
        return;
      }

      await createPool(
        publicKey,
        poolId.trim(),
        token.trim(),
        admins.map((a) => a.trim()),
        threshold
      );
    },
    [publicKey, poolId, token, admins, threshold, createPool]
  );

  const handleSuccessDismiss = () => {
    router.push(`/pools/${poolId.trim()}`);
  };

  if (!isConnected) {
    return (
      <main style={styles.main}>
        <div style={styles.walletGate}>
          <span style={styles.walletIcon} aria-hidden="true">🔒</span>
          <h2 style={styles.walletTitle}>Connect your wallet</h2>
          <p style={styles.walletBody}>You need to connect Freighter to create a pool.</p>
          <Link href="/pools" style={styles.backLink}>← Back to pools</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.main}>
      <div style={styles.container}>
        {/* Back nav */}
        <Link href="/pools" style={styles.back}>
          ← Back to pools
        </Link>

        <header style={styles.header}>
          <h1 style={styles.title}>Create Community Pool</h1>
          <p style={styles.subtitle}>
            Set up an M-of-N multisig treasury pool with a SEP-41 token.
          </p>
        </header>

        <TxStatusBanner
          status={status}
          result={result}
          error={error}
          onReset={status === "success" ? handleSuccessDismiss : reset}
          actionLabel="Pool creation"
        />

        {status === "success" ? (
          <div style={styles.successCard}>
            <p style={styles.successText}>
              Pool <code style={styles.code}>{poolId}</code> created successfully!
            </p>
            <button onClick={handleSuccessDismiss} style={styles.viewPoolBtn}>
              View pool →
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={styles.form} noValidate>
            {/* Pool ID */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>Pool Identity</h2>

              <div style={styles.fieldGroup}>
                <label htmlFor="pool-id" style={styles.label}>
                  Pool ID <span style={styles.required}>*</span>
                </label>
                <input
                  id="pool-id"
                  type="text"
                  value={poolId}
                  onChange={(e) => {
                    setPoolId(e.target.value);
                    if (poolIdError) setPoolIdError(validatePoolId(e.target.value));
                  }}
                  placeholder="e.g. community"
                  maxLength={9}
                  disabled={isSubmitting}
                  style={{ ...styles.input, ...(poolIdError ? styles.inputError : {}) }}
                  aria-describedby={poolIdError ? "pool-id-error" : "pool-id-hint"}
                  aria-invalid={!!poolIdError}
                  autoComplete="off"
                />
                {poolIdError ? (
                  <p id="pool-id-error" style={styles.fieldError} role="alert">{poolIdError}</p>
                ) : (
                  <p id="pool-id-hint" style={styles.hint}>
                    1–9 alphanumeric characters. Used as the on-chain key.
                  </p>
                )}
              </div>

              <div style={styles.fieldGroup}>
                <label htmlFor="pool-token" style={styles.label}>
                  Token address (SEP-41) <span style={styles.required}>*</span>
                </label>
                <input
                  id="pool-token"
                  type="text"
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    if (tokenError) setTokenError(validateToken(e.target.value));
                  }}
                  placeholder="G…"
                  disabled={isSubmitting}
                  style={{
                    ...styles.input,
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-sm)",
                    ...(tokenError ? styles.inputError : {}),
                  }}
                  aria-describedby={tokenError ? "pool-token-error" : "pool-token-hint"}
                  aria-invalid={!!tokenError}
                  autoComplete="off"
                  spellCheck={false}
                />
                {tokenError ? (
                  <p id="pool-token-error" style={styles.fieldError} role="alert">{tokenError}</p>
                ) : (
                  <p id="pool-token-hint" style={styles.hint}>
                    Stellar public key of the SEP-41 token contract.
                  </p>
                )}
              </div>
            </section>

            {/* Admins */}
            <section style={styles.section}>
              <div style={styles.sectionHeader}>
                <h2 style={styles.sectionTitle}>Admin Set</h2>
                <button
                  type="button"
                  onClick={addAdmin}
                  disabled={isSubmitting || admins.length >= 20}
                  style={styles.addAdminBtn}
                >
                  + Add admin
                </button>
              </div>
              <p style={styles.hint}>
                Admins can co-sign withdrawals. At least {threshold} of {admins.length} must sign.
              </p>

              <div style={styles.adminList}>
                {admins.map((addr, i) => (
                  <div key={i} style={styles.adminRow}>
                    <div style={styles.adminAvatar} aria-hidden="true">
                      {i + 1}
                    </div>
                    <div style={styles.adminInputWrapper}>
                      <input
                        type="text"
                        value={addr}
                        onChange={(e) => updateAdmin(i, e.target.value)}
                        placeholder="G…"
                        disabled={isSubmitting}
                        style={{
                          ...styles.input,
                          fontFamily: "var(--font-mono)",
                          fontSize: "var(--text-sm)",
                          ...(adminErrors[i] ? styles.inputError : {}),
                        }}
                        aria-label={`Admin ${i + 1} address`}
                        aria-invalid={!!adminErrors[i]}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      {adminErrors[i] && (
                        <p style={styles.fieldError} role="alert">{adminErrors[i]}</p>
                      )}
                    </div>
                    {admins.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeAdmin(i)}
                        disabled={isSubmitting}
                        style={styles.removeBtn}
                        aria-label={`Remove admin ${i + 1}`}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Threshold */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>Withdrawal Threshold</h2>
              <p style={styles.hint}>
                How many admins must sign before a withdrawal executes.
              </p>

              <div style={styles.thresholdControl}>
                <div style={styles.thresholdRow}>
                  <label htmlFor="threshold-select" style={styles.label}>
                    Required signatures
                  </label>
                  <select
                    id="threshold-select"
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    disabled={isSubmitting}
                    style={styles.select}
                    aria-describedby="threshold-hint"
                  >
                    {Array.from({ length: admins.length }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n} of {admins.length}
                      </option>
                    ))}
                  </select>
                </div>
                <p id="threshold-hint" style={styles.hint}>
                  Threshold must be ≤ number of admins ({admins.length}).
                </p>
                <div style={styles.thresholdPreview}>
                  <ThresholdBadge threshold={threshold} total={admins.length} variant="full" />
                </div>
              </div>
            </section>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                ...styles.submitBtn,
                ...(isSubmitting ? styles.submitBtnDisabled : {}),
              }}
            >
              {isSubmitting ? (
                <>
                  <span aria-hidden="true">⏳</span>
                  {status === "awaiting_sig" ? "Sign in Freighter…" : "Creating pool…"}
                </>
              ) : (
                "Create Pool"
              )}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  main: {
    minHeight: "100vh",
    background: "var(--color-surface-1)",
    padding: "var(--space-8) var(--space-4)",
  },
  container: {
    maxWidth: "640px",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-6)",
  },
  back: {
    fontSize: "var(--text-sm)",
    color: "var(--color-text-secondary)",
    textDecoration: "none",
    fontWeight: 500,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-2)",
  },
  title: {
    margin: 0,
    fontSize: "var(--text-3xl)",
    fontWeight: 700,
    color: "var(--color-text-primary)",
  },
  subtitle: {
    margin: 0,
    fontSize: "var(--text-base)",
    color: "var(--color-text-secondary)",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-6)",
  },
  section: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-xl)",
    padding: "var(--space-6)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    margin: 0,
    fontSize: "var(--text-lg)",
    fontWeight: 700,
    color: "var(--color-text-primary)",
  },
  fieldGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-2)",
  },
  label: {
    fontSize: "var(--text-sm)",
    fontWeight: 600,
    color: "var(--color-text-primary)",
  },
  required: {
    color: "var(--color-error)",
    marginLeft: "2px",
  },
  input: {
    width: "100%",
    padding: "var(--space-3) var(--space-4)",
    border: "1.5px solid var(--color-border)",
    borderRadius: "var(--radius-lg)",
    fontSize: "var(--text-base)",
    background: "var(--color-bg)",
    color: "var(--color-text-primary)",
    outline: "none",
    transition: "border-color 0.2s",
    boxSizing: "border-box" as const,
  },
  inputError: {
    borderColor: "var(--color-error)",
    background: "var(--color-error-light)",
  },
  fieldError: {
    margin: 0,
    fontSize: "var(--text-sm)",
    color: "var(--color-error)",
    fontWeight: 500,
  },
  hint: {
    margin: 0,
    fontSize: "var(--text-sm)",
    color: "var(--color-text-secondary)",
    lineHeight: "var(--leading-relaxed)",
  },
  addAdminBtn: {
    padding: "var(--space-2) var(--space-4)",
    background: "var(--color-primary-light)",
    color: "var(--color-primary)",
    border: "1px solid var(--color-primary)",
    borderRadius: "var(--radius-lg)",
    fontWeight: 600,
    fontSize: "var(--text-sm)",
    cursor: "pointer",
    minHeight: "36px",
    minWidth: "auto",
    transition: "background 0.2s",
  },
  adminList: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-3)",
  },
  adminRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "var(--space-3)",
  },
  adminAvatar: {
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    background: "var(--color-primary-light)",
    color: "var(--color-primary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.8rem",
    fontWeight: 700,
    flexShrink: 0,
    marginTop: "10px",
  },
  adminInputWrapper: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-1)",
    minWidth: 0,
  },
  removeBtn: {
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    background: "var(--color-error-light)",
    color: "var(--color-error)",
    border: "none",
    cursor: "pointer",
    fontSize: "0.8rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: "10px",
    minHeight: "auto",
    minWidth: "auto",
    transition: "background 0.2s",
  },
  thresholdControl: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-3)",
  },
  thresholdRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--space-4)",
  },
  select: {
    padding: "var(--space-2) var(--space-4)",
    border: "1.5px solid var(--color-border)",
    borderRadius: "var(--radius-lg)",
    fontSize: "var(--text-base)",
    background: "var(--color-bg)",
    color: "var(--color-text-primary)",
    cursor: "pointer",
    minWidth: "140px",
    outline: "none",
  },
  thresholdPreview: {
    padding: "var(--space-4)",
    background: "var(--color-surface-1)",
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--color-border)",
  },
  submitBtn: {
    padding: "var(--space-4)",
    background: "var(--color-primary)",
    color: "white",
    borderRadius: "var(--radius-lg)",
    fontWeight: 700,
    fontSize: "var(--text-base)",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--space-2)",
    transition: "background 0.2s, opacity 0.2s",
    minHeight: "52px",
  },
  submitBtnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  // Wallet gate
  walletGate: {
    maxWidth: "400px",
    margin: "var(--space-16) auto",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "var(--space-4)",
  },
  walletIcon: {
    fontSize: "3rem",
  },
  walletTitle: {
    margin: 0,
    fontSize: "var(--text-2xl)",
    fontWeight: 700,
    color: "var(--color-text-primary)",
  },
  walletBody: {
    margin: 0,
    color: "var(--color-text-secondary)",
  },
  backLink: {
    color: "var(--color-primary)",
    textDecoration: "none",
    fontWeight: 500,
    fontSize: "var(--text-sm)",
  },
  // Success
  successCard: {
    padding: "var(--space-8)",
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-xl)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "var(--space-4)",
    textAlign: "center",
  },
  successText: {
    margin: 0,
    fontSize: "var(--text-lg)",
    color: "var(--color-text-primary)",
  },
  viewPoolBtn: {
    padding: "var(--space-3) var(--space-6)",
    background: "var(--color-primary)",
    color: "white",
    borderRadius: "var(--radius-lg)",
    fontWeight: 700,
    fontSize: "var(--text-base)",
    border: "none",
    cursor: "pointer",
    minHeight: "44px",
  },
  code: {
    fontFamily: "var(--font-mono)",
    background: "var(--color-surface-2)",
    padding: "0.1rem 0.4rem",
    borderRadius: "var(--radius-sm)",
    fontSize: "0.9em",
  },
};
