"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

interface ProfileDraft {
  username: string;
  creator_token: string;
}

type SaveState = "idle" | "saving" | "success" | "error";

function validateUsername(value: string): string {
  if (value.length < 3) return "Username must be at least 3 characters.";
  if (value.length > 32) return "Username must be at most 32 characters.";
  if (!/^[a-zA-Z0-9_]+$/.test(value))
    return "Only letters, numbers, and underscores allowed.";
  return "";
}

export default function ProfileEditPage() {
  const params = useParams();
  const router = useRouter();
  const address = params?.address as string;

  const [draft, setDraft] = useState<ProfileDraft>({
    username: "",
    creator_token: "",
  });
  const [usernameError, setUsernameError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch existing profile — replace with real contract call.
    setTimeout(() => {
      setDraft({
        username: "creator_alice",
        creator_token: "GABCDEF1234567890ABCDEF1234567890ABCDEF1",
      });
      setLoading(false);
    }, 300);
  }, [address]);

  const handleUsernameChange = (value: string) => {
    setDraft((d) => ({ ...d, username: value }));
    setUsernameError(validateUsername(value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateUsername(draft.username);
    if (err) {
      setUsernameError(err);
      return;
    }
    setSaveState("saving");
    setErrorMsg("");
    try {
      // Replace with real contract call: set_profile(address, username, creator_token)
      await new Promise((r) => setTimeout(r, 800));
      setSaveState("success");
      setTimeout(() => router.push(`/profile/${address}`), 1000);
    } catch {
      setSaveState("error");
      setErrorMsg("Could not save profile. Please try again.");
    }
  };

  if (loading) {
    return (
      <main style={styles.page}>
        <div style={styles.skeleton} />
        <div style={styles.skeleton} />
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Edit Profile</h1>

        <form onSubmit={handleSubmit} noValidate>
          {/* Username */}
          <div style={styles.field}>
            <label htmlFor="username" style={styles.label}>
              Username
            </label>
            <input
              id="username"
              type="text"
              value={draft.username}
              onChange={(e) => handleUsernameChange(e.target.value)}
              placeholder="3–32 alphanumeric characters or _"
              maxLength={32}
              aria-describedby="username-hint username-error"
              style={{
                ...styles.input,
                ...(usernameError ? styles.inputError : {}),
              }}
            />
            <span id="username-hint" style={styles.hint}>
              Letters, numbers, and underscores only (3–32 chars).
            </span>
            {usernameError && (
              <span
                id="username-error"
                role="alert"
                style={styles.errorText}
              >
                {usernameError}
              </span>
            )}
          </div>

          {/* Creator token */}
          <div style={styles.field}>
            <label htmlFor="creator_token" style={styles.label}>
              Creator Token Address
            </label>
            <input
              id="creator_token"
              type="text"
              value={draft.creator_token}
              onChange={(e) =>
                setDraft((d) => ({ ...d, creator_token: e.target.value }))
              }
              placeholder="Stellar asset address (G…)"
              style={styles.input}
            />
            <span style={styles.hint}>
              The Stellar address of your creator token contract.
            </span>
          </div>

          {/* Save state feedback */}
          {saveState === "error" && errorMsg && (
            <p role="alert" style={styles.errorBanner}>
              {errorMsg}
            </p>
          )}
          {saveState === "success" && (
            <p role="status" style={styles.successBanner}>
              Profile saved! Redirecting…
            </p>
          )}

          <div style={styles.buttonRow}>
            <button
              type="button"
              onClick={() => router.push(`/profile/${address}`)}
              style={styles.cancelBtn}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                saveState === "saving" ||
                saveState === "success" ||
                !!usernameError
              }
              style={{
                ...styles.saveBtn,
                ...(saveState === "saving" || !!usernameError
                  ? styles.saveBtnDisabled
                  : {}),
              }}
            >
              {saveState === "saving" ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: "480px",
    margin: "0 auto",
    padding: "var(--spacing-lg)",
    minHeight: "100vh",
    background: "var(--color-bg-secondary)",
  },
  card: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    padding: "var(--spacing-lg)",
  },
  title: {
    fontSize: "1.25rem",
    fontWeight: 700,
    marginBottom: "var(--spacing-lg)",
    color: "var(--color-text)",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-xs)",
    marginBottom: "var(--spacing-lg)",
  },
  label: {
    fontSize: "0.9rem",
    fontWeight: 600,
    color: "var(--color-text)",
  },
  input: {
    padding: "var(--spacing-sm) var(--spacing-md)",
    border: "1px solid var(--color-border)",
    borderRadius: "8px",
    fontSize: "0.95rem",
    minHeight: "var(--min-touch-target)",
    background: "var(--color-bg)",
    color: "var(--color-text)",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  inputError: {
    borderColor: "#ef4444",
  },
  hint: {
    fontSize: "0.78rem",
    color: "var(--color-text-secondary)",
  },
  errorText: {
    fontSize: "0.82rem",
    color: "#ef4444",
    fontWeight: 500,
  },
  errorBanner: {
    background: "#fee2e2",
    color: "#991b1b",
    borderRadius: "8px",
    padding: "var(--spacing-sm) var(--spacing-md)",
    fontSize: "0.88rem",
    marginBottom: "var(--spacing-md)",
  },
  successBanner: {
    background: "#d1fae5",
    color: "#065f46",
    borderRadius: "8px",
    padding: "var(--spacing-sm) var(--spacing-md)",
    fontSize: "0.88rem",
    marginBottom: "var(--spacing-md)",
  },
  buttonRow: {
    display: "flex",
    gap: "var(--spacing-md)",
    justifyContent: "flex-end",
  },
  cancelBtn: {
    padding: "var(--spacing-sm) var(--spacing-lg)",
    background: "var(--color-bg-secondary)",
    color: "var(--color-text)",
    borderRadius: "8px",
    fontWeight: 600,
    minHeight: "var(--min-touch-target)",
    border: "1px solid var(--color-border)",
    cursor: "pointer",
  },
  saveBtn: {
    padding: "var(--spacing-sm) var(--spacing-lg)",
    background: "var(--color-primary)",
    color: "white",
    borderRadius: "8px",
    fontWeight: 600,
    minHeight: "var(--min-touch-target)",
    cursor: "pointer",
    transition: "background 0.15s",
  },
  saveBtnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  skeleton: {
    height: "60px",
    borderRadius: "8px",
    background: "var(--color-bg-secondary)",
    marginBottom: "var(--spacing-md)",
  },
};
