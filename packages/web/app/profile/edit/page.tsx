"use client";

import { useState, useEffect } from "react";

interface FormData {
  username: string;
  creatorToken: string;
}

interface ProfileData {
  username: string;
  creatorToken: string;
}

export default function ProfileEditPage() {
  const [formData, setFormData] = useState<FormData>({
    username: "",
    creatorToken: "",
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [walletConnected, setWalletConnected] = useState(false);

  useEffect(() => {
    const isWalletConnected = !!localStorage.getItem("walletAddress");
    setWalletConnected(isWalletConnected);

    if (!isWalletConnected) {
      setLoading(false);
      return;
    }

    const fetchProfile = async () => {
      try {
        const userAddress = localStorage.getItem("walletAddress");
        if (!userAddress) return;

        // TODO: Call get_profile(userAddress) via contract SDK
        // For now, mock the behavior
        setTimeout(() => {
          setLoading(false);
        }, 500);
      } catch (err) {
        console.error("Failed to load profile:", err);
        setError("Failed to load your profile");
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  const validateUsername = (username: string): boolean => {
    if (username.length < 3 || username.length > 32) return false;
    return /^[a-zA-Z0-9_]+$/.test(username);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateUsername(formData.username)) {
      setError(
        "Username must be 3-32 characters, alphanumeric and underscores only"
      );
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const userAddress = localStorage.getItem("walletAddress");
      if (!userAddress) {
        setError("Wallet not connected");
        setSubmitting(false);
        return;
      }

      // TODO: Call set_profile(userAddress, username, creatorToken) via contract SDK
      // Wait for contract interaction
      await new Promise((resolve) => setTimeout(resolve, 1000));

      setSuccess(true);
      setError(null);

      setTimeout(() => {
        setSuccess(false);
      }, 3000);
    } catch (err) {
      console.error("Failed to update profile:", err);
      setError(
        err instanceof Error ? err.message : "Failed to update profile"
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!walletConnected) {
    return (
      <main style={styles.main}>
        <div style={styles.container}>
          <h1 style={styles.title}>Edit Profile</h1>
          <div style={styles.message}>
            <p>Please connect your wallet to edit your profile.</p>
            <button
              style={styles.connectButton}
              onClick={() => {
                // TODO: Implement wallet connection
                alert("Wallet connection not yet implemented");
              }}
            >
              Connect Wallet
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main style={styles.main}>
        <div style={styles.container}>
          <h1 style={styles.title}>Edit Profile</h1>
          <p style={styles.loading}>Loading profile...</p>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.main}>
      <div style={styles.container}>
        <h1 style={styles.title}>Edit Profile</h1>

        {error && <div style={styles.error}>{error}</div>}
        {success && (
          <div style={styles.success}>
            Profile updated successfully!
          </div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.formGroup}>
            <label htmlFor="username" style={styles.label}>
              Username
            </label>
            <input
              type="text"
              id="username"
              name="username"
              value={formData.username}
              onChange={handleInputChange}
              placeholder="Enter your username (3-32 characters)"
              style={styles.input}
              minLength={3}
              maxLength={32}
              disabled={submitting}
            />
            <p style={styles.helperText}>
              3-32 characters, alphanumeric and underscores only
            </p>
          </div>

          <div style={styles.formGroup}>
            <label htmlFor="creatorToken" style={styles.label}>
              Creator Token Address (Optional)
            </label>
            <input
              type="text"
              id="creatorToken"
              name="creatorToken"
              value={formData.creatorToken}
              onChange={handleInputChange}
              placeholder="Enter creator token address or leave blank"
              style={styles.input}
              disabled={submitting}
            />
            <p style={styles.helperText}>
              SEP-41 token address (pass your own address if you haven't deployed a token)
            </p>
          </div>

          <button
            type="submit"
            style={styles.submitButton}
            disabled={submitting || !formData.username}
          >
            {submitting ? "Saving..." : "Save Profile"}
          </button>
        </form>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: "100vh",
    background: "var(--color-bg-secondary)",
    padding: "var(--spacing-lg)",
  },
  container: {
    maxWidth: "600px",
    margin: "0 auto",
  },
  title: {
    fontSize: "1.875rem",
    fontWeight: 700,
    marginBottom: "var(--spacing-lg)",
    textAlign: "center",
  },
  message: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    padding: "var(--spacing-lg)",
    textAlign: "center",
  },
  connectButton: {
    marginTop: "var(--spacing-md)",
    padding: "0.75rem 1.5rem",
    background: "var(--color-primary)",
    color: "white",
    border: "none",
    borderRadius: "8px",
    fontWeight: 600,
    cursor: "pointer",
    minHeight: "var(--min-touch-target)",
  },
  loading: {
    textAlign: "center",
    color: "var(--color-text-secondary)",
  },
  form: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    padding: "var(--spacing-lg)",
    marginTop: "var(--spacing-lg)",
  },
  formGroup: {
    marginBottom: "var(--spacing-lg)",
  },
  label: {
    display: "block",
    marginBottom: "var(--spacing-sm)",
    fontWeight: 600,
    fontSize: "0.95rem",
  },
  input: {
    width: "100%",
    padding: "var(--spacing-md)",
    border: "1px solid var(--color-border)",
    borderRadius: "8px",
    fontSize: "1rem",
    boxSizing: "border-box",
    background: "var(--color-bg-secondary)",
    color: "var(--color-text)",
  },
  helperText: {
    marginTop: "var(--spacing-sm)",
    fontSize: "0.85rem",
    color: "var(--color-text-secondary)",
  },
  submitButton: {
    width: "100%",
    padding: "0.75rem",
    background: "var(--color-primary)",
    color: "white",
    border: "none",
    borderRadius: "8px",
    fontWeight: 600,
    fontSize: "1rem",
    cursor: "pointer",
    minHeight: "var(--min-touch-target)",
  },
  error: {
    background: "rgba(220, 38, 38, 0.1)",
    color: "rgb(220, 38, 38)",
    padding: "var(--spacing-md)",
    borderRadius: "8px",
    marginBottom: "var(--spacing-md)",
    border: "1px solid rgba(220, 38, 38, 0.3)",
  },
  success: {
    background: "rgba(34, 197, 94, 0.1)",
    color: "rgb(34, 197, 94)",
    padding: "var(--spacing-md)",
    borderRadius: "8px",
    marginBottom: "var(--spacing-md)",
    border: "1px solid rgba(34, 197, 94, 0.3)",
  },
};
