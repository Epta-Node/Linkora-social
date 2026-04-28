"use client";

import { useState, useCallback } from "react";
import { useWallet } from "../components/WalletProvider";

interface Pool {
  token: string;
  balance: number;
}

export default function PoolsPage() {
  const { publicKey, isConnected } = useWallet();

  const [searchPoolId, setSearchPoolId] = useState("");
  const [pool, setPool] = useState<Pool | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [depositPoolId, setDepositPoolId] = useState("");
  const [depositToken, setDepositToken] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [isDepositing, setIsDepositing] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [depositSuccess, setDepositSuccess] = useState(false);

  const [withdrawPoolId, setWithdrawPoolId] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState(false);

  const handleSearch = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchPoolId.trim()) return;

    setLoading(true);
    setError(null);
    setPool(null);

    try {
      console.log("Fetching pool:", searchPoolId);
      await new Promise((resolve) => setTimeout(resolve, 1000));

      setPool({
        token: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        balance: 1000000000,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pool not found");
    } finally {
      setLoading(false);
    }
  }, [searchPoolId]);

  const handleDeposit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected) return;

    const amount = Number(depositAmount);
    if (amount <= 0) {
      setDepositError("Amount must be a positive number");
      return;
    }

    setIsDepositing(true);
    setDepositError(null);
    setDepositSuccess(false);

    try {
      console.log("Depositing to pool:", depositPoolId, "amount:", amount, "token:", depositToken);
      await new Promise((resolve) => setTimeout(resolve, 1500));

      setDepositSuccess(true);
      setDepositToken("");
      setDepositAmount("");

      if (pool && pool.token === depositToken) {
        setPool((prev) => prev ? { ...prev, balance: prev.balance + amount } : prev);
      }
    } catch (err) {
      setDepositError(err instanceof Error ? err.message : "Failed to deposit");
    } finally {
      setIsDepositing(false);
    }
  }, [isConnected, depositPoolId, depositToken, depositAmount, pool]);

  const handleWithdraw = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected) return;

    const amount = Number(withdrawAmount);
    if (amount <= 0) {
      setWithdrawError("Amount must be a positive number");
      return;
    }

    setIsWithdrawing(true);
    setWithdrawError(null);
    setWithdrawSuccess(false);

    try {
      console.log("Withdrawing from pool:", withdrawPoolId, "amount:", amount);
      await new Promise((resolve) => setTimeout(resolve, 1500));

      setWithdrawSuccess(true);
      setWithdrawAmount("");

      if (pool && amount <= pool.balance) {
        setPool((prev) => prev ? { ...prev, balance: prev.balance - amount } : prev);
      }
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : "Failed to withdraw");
    } finally {
      setIsWithdrawing(false);
    }
  }, [isConnected, withdrawPoolId, withdrawAmount, pool]);

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const formatBalance = (balance: number) => {
    return (balance / 10_000_000).toFixed(2);
  };

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <h1 style={styles.title}>Community Pools</h1>
        <p style={styles.subtitle}>View pool balances, deposit, and withdraw tokens</p>
      </header>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Look Up Pool</h2>
        <form onSubmit={handleSearch} style={styles.form}>
          <input
            type="text"
            value={searchPoolId}
            onChange={(e) => setSearchPoolId(e.target.value)}
            placeholder="Enter pool ID (e.g., community)"
            style={styles.input}
            maxLength={9}
            disabled={loading}
          />
          <button type="submit" disabled={loading || !searchPoolId.trim()} style={styles.button}>
            {loading ? "Loading..." : "Search"}
          </button>
        </form>

        {error && <p style={styles.error}>{error}</p>}

        {pool && (
          <div style={styles.poolInfo}>
            <div style={styles.poolRow}>
              <span style={styles.poolLabel}>Pool ID:</span>
              <span style={styles.poolValue}>{searchPoolId}</span>
            </div>
            <div style={styles.poolRow}>
              <span style={styles.poolLabel}>Token:</span>
              <span style={styles.poolValue}>{formatAddress(pool.token)}</span>
            </div>
            <div style={styles.poolRow}>
              <span style={styles.poolLabel}>Balance:</span>
              <span style={styles.poolValue}>{formatBalance(pool.balance)} XLM</span>
            </div>
          </div>
        )}
      </section>

      {isConnected ? (
        <>
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Deposit</h2>
            <form onSubmit={handleDeposit} style={styles.form}>
              <input
                type="text"
                value={depositPoolId}
                onChange={(e) => setDepositPoolId(e.target.value)}
                placeholder="Pool ID"
                style={styles.input}
                maxLength={9}
                disabled={isDepositing}
              />
              <input
                type="text"
                value={depositToken}
                onChange={(e) => setDepositToken(e.target.value)}
                placeholder="Token address"
                style={styles.input}
                disabled={isDepositing}
              />
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="Amount"
                min="1"
                step="1"
                style={styles.input}
                disabled={isDepositing}
              />
              {depositError && <p style={styles.error}>{depositError}</p>}
              {depositSuccess && <p style={styles.success}>Deposit successful!</p>}
              <button
                type="submit"
                disabled={
                  isDepositing ||
                  !depositPoolId ||
                  !depositToken ||
                  !depositAmount ||
                  Number(depositAmount) <= 0
                }
                style={{
                  ...styles.submitButton,
                  ...(isDepositing ||
                  !depositPoolId ||
                  !depositToken ||
                  !depositAmount ||
                  Number(depositAmount) <= 0
                    ? styles.buttonDisabled
                    : {}),
                }}
              >
                {isDepositing ? "Depositing..." : "Deposit"}
              </button>
            </form>
          </section>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Withdraw</h2>
            <form onSubmit={handleWithdraw} style={styles.form}>
              <input
                type="text"
                value={withdrawPoolId}
                onChange={(e) => setWithdrawPoolId(e.target.value)}
                placeholder="Pool ID"
                style={styles.input}
                maxLength={9}
                disabled={isWithdrawing}
              />
              <input
                type="number"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="Amount"
                min="1"
                step="1"
                style={styles.input}
                disabled={isWithdrawing}
              />
              {withdrawError && <p style={styles.error}>{withdrawError}</p>}
              {withdrawSuccess && <p style={styles.success}>Withdrawal successful!</p>}
              <button
                type="submit"
                disabled={
                  isWithdrawing ||
                  !withdrawPoolId ||
                  !withdrawAmount ||
                  Number(withdrawAmount) <= 0
                }
                style={{
                  ...styles.submitButton,
                  ...(isWithdrawing ||
                  !withdrawPoolId ||
                  !withdrawAmount ||
                  Number(withdrawAmount) <= 0
                    ? styles.buttonDisabled
                    : {}),
                }}
              >
                {isWithdrawing ? "Withdrawing..." : "Withdraw"}
              </button>
            </form>
          </section>
        </>
      ) : (
        <section style={styles.section}>
          <p style={styles.placeholder}>Connect wallet to deposit or withdraw</p>
        </section>
      )}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: "100vh",
    background: "var(--color-bg-secondary)",
    padding: "var(--spacing-lg)",
  },
  header: {
    textAlign: "center",
    marginBottom: "var(--spacing-xl)",
  },
  title: {
    fontSize: "2rem",
    fontWeight: 700,
    marginBottom: "var(--spacing-sm)",
  },
  subtitle: {
    color: "var(--color-text-secondary)",
    fontSize: "1.1rem",
  },
  section: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    padding: "var(--spacing-xl)",
    maxWidth: "600px",
    margin: "0 auto var(--spacing-lg)",
  },
  sectionTitle: {
    fontSize: "1.25rem",
    fontWeight: 600,
    marginBottom: "var(--spacing-md)",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-md)",
  },
  input: {
    padding: "var(--spacing-md)",
    border: "1px solid var(--color-border)",
    borderRadius: "8px",
    fontSize: "1rem",
    width: "100%",
  },
  button: {
    padding: "var(--spacing-md)",
    background: "var(--color-primary)",
    color: "white",
    borderRadius: "8px",
    fontWeight: 600,
    fontSize: "1rem",
  },
  submitButton: {
    padding: "var(--spacing-md)",
    background: "var(--color-primary)",
    color: "white",
    borderRadius: "8px",
    fontWeight: 600,
    fontSize: "1rem",
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: "not-allowed",
  },
  poolInfo: {
    marginTop: "var(--spacing-lg)",
    padding: "var(--spacing-lg)",
    background: "var(--color-bg-secondary)",
    borderRadius: "8px",
  },
  poolRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "var(--spacing-sm) 0",
  },
  poolLabel: {
    color: "var(--color-text-secondary)",
  },
  poolValue: {
    fontFamily: "monospace",
    fontWeight: 500,
  },
  error: {
    color: "var(--color-like)",
    fontSize: "0.9rem",
  },
  success: {
    color: "#10b981",
    fontSize: "0.9rem",
  },
  placeholder: {
    textAlign: "center",
    color: "var(--color-text-secondary)",
    padding: "var(--spacing-lg)",
  },
};