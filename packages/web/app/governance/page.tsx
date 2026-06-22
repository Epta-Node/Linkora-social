"use client";

import React, { useState, useEffect, useCallback, CSSProperties } from "react";
import { useWallet } from "../components/WalletProvider";

// ── Types ─────────────────────────────────────────────────────────────────────

type GovParameter =
  | "FeeBps"
  | "Treasury"
  | "TipCooldownWindow"
  | "GovQuorum"
  | "GovTimeLock"
  | "GovVoteWindow";

type GovStatus = "Active" | "Passed" | "Executed" | "Vetoed" | "Failed";

interface GovProposal {
  id: number;
  proposer: string;
  parameter: GovParameter;
  new_value: number;
  new_address?: string | null;
  votes_for: number;
  votes_against: number;
  created_ledger: number;
  status: GovStatus;
}

interface GovConfig {
  quorum: number;
  time_lock_ledgers: number;
  vote_window_ledgers: number;
  quorum_decay_rate_bps: number;
  quorum_floor: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TOTAL_SUPPLY = 1000000; // Mock governance token total supply
const ADMINS = [
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  "GBVVJJWAKJHTEQHZGM5AOKXJLNBGKDSMXZXJZXJZXJZXJZXJZXJZXJ",
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GovernancePage() {
  const { publicKey, isConnected } = useWallet();

  const [config] = useState<GovConfig>({
    quorum: 60, // 60%
    time_lock_ledgers: 100,
    vote_window_ledgers: 200,
    quorum_decay_rate_bps: 50,
    quorum_floor: 30,
  });

  const [proposals, setProposals] = useState<GovProposal[]>([
    {
      id: 1,
      proposer: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      parameter: "FeeBps",
      new_value: 500,
      new_address: null,
      votes_for: 75000,
      votes_against: 25000,
      created_ledger: 1000,
      status: "Executed",
    },
    {
      id: 2,
      proposer: "GBVVJJWAKJHTEQHZGM5AOKXJLNBGKDSMXZXJZXJZXJZXJZXJZXJZXJ",
      parameter: "TipCooldownWindow",
      new_value: 3600,
      new_address: null,
      votes_for: 120000,
      votes_against: 40000,
      created_ledger: 12345,
      status: "Active",
    },
    {
      id: 3,
      proposer: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZXG5CHCGZXG5CHCGZXG5",
      parameter: "GovQuorum",
      new_value: 50,
      new_address: null,
      votes_for: 200000,
      votes_against: 10000,
      created_ledger: 12350,
      status: "Active",
    },
    {
      id: 4,
      proposer: "GDFOHLMYCXVZD2CDXZLMIRQZPEAXE7B5MURMIZ4IYQUENHZSJPINMQB",
      parameter: "Treasury",
      new_value: 0,
      new_address: "GDQOE23CFSUMSVQK4Y5JHPPYK73VYCNHZHA7ENKCV37P6SUEO6XQBKPP",
      votes_for: 10000,
      votes_against: 180000,
      created_ledger: 11000,
      status: "Vetoed",
    },
  ]);

  // Track user votes in local state
  const [votedProposalIds, setVotedProposalIds] = useState<number[]>([]);

  // Form states
  const [parameter, setParameter] = useState<GovParameter>("FeeBps");
  const [newValue, setNewValue] = useState<string>("");
  const [newAddress, setNewAddress] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);
  const [txMessage, setTxMessage] = useState<string | null>(null);

  // Veto action (admin-only)
  const isAdmin = isConnected && publicKey && ADMINS.includes(publicKey);

  const handleVote = useCallback(
    async (proposalId: number, support: boolean) => {
      if (!isConnected || !publicKey) return;

      setTxMessage("Awaiting Freighter signature...");
      await new Promise((r) => setTimeout(r, 600));

      setTxMessage("Broadcasting transaction...");
      await new Promise((r) => setTimeout(r, 800));

      setProposals((prev) =>
        prev.map((p) => {
          if (p.id === proposalId) {
            const addedVotes = 10000; // Simulate vote weight
            return {
              ...p,
              votes_for: support ? p.votes_for + addedVotes : p.votes_for,
              votes_against: !support ? p.votes_against + addedVotes : p.votes_against,
            };
          }
          return p;
        })
      );
      setVotedProposalIds((prev) => [...prev, proposalId]);
      setTxMessage(null);
    },
    [isConnected, publicKey]
  );

  const handleVeto = useCallback(
    async (proposalId: number) => {
      if (!isAdmin) return;

      setTxMessage("Awaiting Freighter signature (Admin Veto)...");
      await new Promise((r) => setTimeout(r, 800));

      setProposals((prev) =>
        prev.map((p) => {
          if (p.id === proposalId) {
            return { ...p, status: "Vetoed" };
          }
          return p;
        })
      );
      setTxMessage(null);
    },
    [isAdmin]
  );

  const handleCreateProposal = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setFormError(null);

      if (!isConnected || !publicKey) {
        setFormError("Wallet connection required.");
        return;
      }

      // Validations
      if (parameter === "Treasury") {
        if (!newAddress || !newAddress.startsWith("G") || newAddress.length !== 56) {
          setFormError("A valid Stellar treasury address is required.");
          return;
        }
      } else {
        const val = Number(newValue);
        if (isNaN(val) || newValue.trim() === "") {
          setFormError("A numeric value is required.");
          return;
        }

        if (parameter === "FeeBps") {
          if (val < 0 || val > 10000) {
            setFormError("Fee bps must be between 0 and 10000.");
            return;
          }
        } else if (parameter === "GovQuorum") {
          if (val < 1 || val > 100) {
            setFormError("Quorum must be between 1 and 100.");
            return;
          }
        } else if (
          parameter === "TipCooldownWindow" ||
          parameter === "GovTimeLock" ||
          parameter === "GovVoteWindow"
        ) {
          if (val <= 0) {
            setFormError("Cooldown and lock windows must be positive.");
            return;
          }
        }
      }

      setTxMessage("Proposing parameter change in Freighter...");
      await new Promise((r) => setTimeout(r, 1000));

      const newProp: GovProposal = {
        id: proposals.length + 1,
        proposer: publicKey,
        parameter,
        new_value: parameter === "Treasury" ? 0 : Number(newValue),
        new_address: parameter === "Treasury" ? newAddress : null,
        votes_for: 0,
        votes_against: 0,
        created_ledger: 12400,
        status: "Active",
      };

      setProposals((prev) => [...prev, newProp]);
      setNewValue("");
      setNewAddress("");
      setTxMessage(null);
    },
    [isConnected, publicKey, parameter, newValue, newAddress, proposals.length]
  );

  const activeProposals = proposals.filter((p) => p.status === "Active");
  const executedProposals = proposals.filter(
    (p) => p.status === "Executed" || p.status === "Vetoed" || p.status === "Failed"
  );

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <div style={styles.headerText}>
          <h1 style={styles.title}>Governance</h1>
          <p style={styles.subtitle}>
            Propose and vote on protocol parameters using your governance tokens
          </p>
        </div>
      </header>

      {txMessage && (
        <div style={styles.txNotification}>
          <span>⏳ {txMessage}</span>
        </div>
      )}

      <div style={styles.layoutGrid}>
        {/* Left Column: Proposals List */}
        <section style={styles.leftCol}>
          <h2 style={styles.sectionTitle}>Active Proposals</h2>
          {activeProposals.length === 0 ? (
            <p style={styles.emptyState}>No active proposals at this time.</p>
          ) : (
            <div style={styles.proposalList}>
              {activeProposals.map((proposal) => {
                const totalVotes = proposal.votes_for + proposal.votes_against;
                const votesForPctOfSupply = (proposal.votes_for / TOTAL_SUPPLY) * 100;
                // Calculate progress % toward meeting the target quorum (e.g. 60%)
                const quorumProgress =
                  config.quorum > 0
                    ? Math.min((votesForPctOfSupply / config.quorum) * 100, 100)
                    : 100;

                const hasVoted = votedProposalIds.includes(proposal.id);

                return (
                  <article key={proposal.id} style={styles.card}>
                    <div style={styles.cardHeader}>
                      <span style={styles.paramBadge}>{proposal.parameter}</span>
                      <span style={styles.proposalId}>Proposal #{proposal.id}</span>
                    </div>

                    <div style={styles.proposalDetails}>
                      <p style={styles.detailRow}>
                        <strong>Proposed Value:</strong>{" "}
                        {proposal.parameter === "Treasury"
                          ? proposal.new_address
                          : proposal.new_value}
                      </p>
                      <p style={styles.detailRow}>
                        <strong>Proposer:</strong>{" "}
                        <span style={styles.addr}>{proposal.proposer}</span>
                      </p>
                      <p style={styles.detailRow}>
                        <strong>Time Remaining:</strong> ~150 ledgers
                      </p>
                    </div>

                    {/* Quorum Progress Bar */}
                    <div style={styles.quorumSection}>
                      <div style={styles.quorumLabelRow}>
                        <span>Quorum Indicator</span>
                        <span>{votesForPctOfSupply.toFixed(1)}% / {config.quorum}% Target</span>
                      </div>
                      <div style={styles.progressBarBg}>
                        <div
                          style={{
                            ...styles.progressBarFill,
                            width: `${quorumProgress}%`,
                          }}
                        />
                      </div>
                    </div>

                    {/* Votes Count */}
                    <div style={styles.votesCountRow}>
                      <span style={styles.voteCountFor}>👍 For: {proposal.votes_for.toLocaleString()}</span>
                      <span style={styles.voteCountAgainst}>👎 Against: {proposal.votes_against.toLocaleString()}</span>
                    </div>

                    {/* Voting Actions */}
                    {isConnected ? (
                      <div style={styles.votingActions}>
                        <button
                          onClick={() => handleVote(proposal.id, true)}
                          disabled={hasVoted}
                          style={{
                            ...styles.voteBtn,
                            ...styles.voteBtnFor,
                            ...(hasVoted ? styles.disabledBtn : {}),
                          }}
                        >
                          Vote For
                        </button>
                        <button
                          onClick={() => handleVote(proposal.id, false)}
                          disabled={hasVoted}
                          style={{
                            ...styles.voteBtn,
                            ...styles.voteBtnAgainst,
                            ...(hasVoted ? styles.disabledBtn : {}),
                          }}
                        >
                          Vote Against
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => handleVeto(proposal.id)}
                            style={{
                              ...styles.voteBtn,
                              ...styles.vetoBtn,
                            }}
                          >
                            Veto Proposal
                          </button>
                        )}
                      </div>
                    ) : (
                      <p style={styles.warning}>Connect your wallet to vote on this proposal.</p>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          <h2 style={{ ...styles.sectionTitle, marginTop: "var(--space-8)" }}>
            Executed History
          </h2>
          {executedProposals.length === 0 ? (
            <p style={styles.emptyState}>No completed proposals in history.</p>
          ) : (
            <div style={styles.proposalList}>
              {executedProposals.map((proposal) => (
                <article key={proposal.id} style={{ ...styles.card, opacity: 0.85 }}>
                  <div style={styles.cardHeader}>
                    <span style={styles.paramBadge}>{proposal.parameter}</span>
                    <span
                      style={{
                        ...styles.statusBadge,
                        ...(proposal.status === "Executed"
                          ? styles.statusExecuted
                          : styles.statusVetoed),
                      }}
                    >
                      {proposal.status}
                    </span>
                  </div>
                  <div style={styles.proposalDetails}>
                    <p style={styles.detailRow}>
                      <strong>Value:</strong>{" "}
                      {proposal.parameter === "Treasury"
                        ? proposal.new_address
                        : proposal.new_value}
                    </p>
                    <p style={styles.detailRow}>
                      <strong>Proposer:</strong> <span style={styles.addr}>{proposal.proposer}</span>
                    </p>
                    <p style={styles.detailRow}>
                      <strong>Result:</strong> 👍 {proposal.votes_for.toLocaleString()} vs 👎{" "}
                      {proposal.votes_against.toLocaleString()}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* Right Column: Create Proposal Form */}
        <aside style={styles.rightCol}>
          <div style={styles.formContainer}>
            <h2 style={styles.formTitle}>Create Proposal</h2>
            {isConnected ? (
              <form onSubmit={handleCreateProposal} style={styles.form}>
                <div style={styles.formGroup}>
                  <label htmlFor="param-select" style={styles.label}>
                    Parameter to Change
                  </label>
                  <select
                    id="param-select"
                    value={parameter}
                    onChange={(e) => {
                      setParameter(e.target.value as GovParameter);
                      setFormError(null);
                    }}
                    style={styles.select}
                  >
                    <option value="FeeBps">Fee Bps (0-10000)</option>
                    <option value="Treasury">Treasury Address</option>
                    <option value="TipCooldownWindow">Tip Cooldown Window</option>
                    <option value="GovQuorum">Governance Quorum (1-100)</option>
                    <option value="GovTimeLock">Time Lock Ledgers</option>
                    <option value="GovVoteWindow">Vote Window Ledgers</option>
                  </select>
                </div>

                {parameter === "Treasury" ? (
                  <div style={styles.formGroup}>
                    <label htmlFor="treasury-input" style={styles.label}>
                      New Address
                    </label>
                    <input
                      id="treasury-input"
                      type="text"
                      placeholder="e.g. G..."
                      value={newAddress}
                      onChange={(e) => {
                        setNewAddress(e.target.value);
                        setFormError(null);
                      }}
                      style={styles.input}
                    />
                  </div>
                ) : (
                  <div style={styles.formGroup}>
                    <label htmlFor="value-input" style={styles.label}>
                      New Value
                    </label>
                    <input
                      id="value-input"
                      type="number"
                      placeholder="Enter integer value"
                      value={newValue}
                      onChange={(e) => {
                        setNewValue(e.target.value);
                        setFormError(null);
                      }}
                      style={styles.input}
                    />
                  </div>
                )}

                {formError && <p style={styles.errorText}>⚠️ {formError}</p>}

                <button type="submit" style={styles.submitBtn}>
                  Submit Proposal
                </button>
              </form>
            ) : (
              <div style={styles.authWrapper}>
                <p style={styles.warning}>Please connect your wallet to create a proposal.</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  main: {
    minHeight: "100vh",
    background: "var(--color-surface-1)",
    padding: "var(--space-8) var(--space-4)",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  header: {
    maxWidth: "1100px",
    margin: "0 auto var(--space-8)",
  },
  headerText: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-1)",
  },
  title: {
    fontSize: "var(--text-3xl)",
    fontWeight: 800,
    color: "var(--color-text-primary)",
    margin: 0,
  },
  subtitle: {
    fontSize: "var(--text-md)",
    color: "var(--color-text-secondary)",
    margin: 0,
  },
  layoutGrid: {
    maxWidth: "1100px",
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: "var(--space-8)",
  },
  // Media query breakpoint handles layoutGrid templateColumns in browser stylesheet:
  // @media (min-width: 768px) { gridTemplateColumns: "1fr 340px" }
  leftCol: {
    display: "flex",
    flexDirection: "column",
  },
  rightCol: {},
  sectionTitle: {
    fontSize: "var(--text-xl)",
    fontWeight: 700,
    color: "var(--color-text-primary)",
    margin: "0 0 var(--space-4)",
  },
  proposalList: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
  },
  card: {
    background: "var(--color-surface-2)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-lg)",
    padding: "var(--space-5)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  paramBadge: {
    background: "var(--color-primary-light)",
    color: "var(--color-primary)",
    fontWeight: 700,
    fontSize: "var(--text-xs)",
    padding: "var(--space-1) var(--space-2.5)",
    borderRadius: "var(--radius-sm)",
  },
  proposalId: {
    fontSize: "var(--text-sm)",
    color: "var(--color-text-secondary)",
    fontWeight: 500,
  },
  proposalDetails: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-1.5)",
    fontSize: "var(--text-sm)",
  },
  detailRow: {
    margin: 0,
    color: "var(--color-text-primary)",
  },
  addr: {
    fontFamily: "monospace",
    color: "var(--color-text-secondary)",
  },
  quorumSection: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-1.5)",
    fontSize: "var(--text-xs)",
    color: "var(--color-text-secondary)",
  },
  quorumLabelRow: {
    display: "flex",
    justifyContent: "space-between",
    fontWeight: 500,
  },
  progressBarBg: {
    background: "var(--color-border)",
    height: "8px",
    borderRadius: "var(--radius-sm)",
    overflow: "hidden",
  },
  progressBarFill: {
    background: "var(--color-primary)",
    height: "100%",
    borderRadius: "var(--radius-sm)",
    transition: "width 0.4s ease-out",
  },
  votesCountRow: {
    display: "flex",
    gap: "var(--space-4)",
    fontSize: "var(--text-xs)",
    fontWeight: 600,
  },
  voteCountFor: {
    color: "#059669",
  },
  voteCountAgainst: {
    color: "#dc2626",
  },
  votingActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--space-2)",
    marginTop: "var(--space-1)",
  },
  voteBtn: {
    padding: "var(--space-2) var(--space-4)",
    borderRadius: "var(--radius-md)",
    fontWeight: 600,
    fontSize: "var(--text-xs)",
    cursor: "pointer",
    border: "none",
    transition: "all 0.2s",
    minHeight: "36px",
  },
  voteBtnFor: {
    background: "#059669",
    color: "white",
  },
  voteBtnAgainst: {
    background: "#dc2626",
    color: "white",
  },
  vetoBtn: {
    background: "#b45309",
    color: "white",
  },
  disabledBtn: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  warning: {
    margin: 0,
    fontSize: "var(--text-xs)",
    color: "#b45309",
    fontWeight: 500,
  },
  emptyState: {
    color: "var(--color-text-secondary)",
    fontSize: "var(--text-sm)",
    margin: 0,
  },
  statusBadge: {
    fontWeight: 700,
    fontSize: "var(--text-xs)",
    padding: "var(--space-1) var(--space-2.5)",
    borderRadius: "var(--radius-sm)",
  },
  statusExecuted: {
    background: "#d1fae5",
    color: "#065f46",
  },
  statusVetoed: {
    background: "#fef3c7",
    color: "#92400e",
  },
  formContainer: {
    background: "var(--color-surface-2)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-lg)",
    padding: "var(--space-5)",
  },
  formTitle: {
    fontSize: "var(--text-lg)",
    fontWeight: 700,
    color: "var(--color-text-primary)",
    margin: "0 0 var(--space-4)",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
  },
  formGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-1.5)",
  },
  label: {
    fontSize: "var(--text-xs)",
    fontWeight: 600,
    color: "var(--color-text-secondary)",
  },
  select: {
    padding: "var(--space-2.5)",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface-1)",
    color: "var(--color-text-primary)",
    fontSize: "var(--text-sm)",
    outline: "none",
  },
  input: {
    padding: "var(--space-2.5)",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface-1)",
    color: "var(--color-text-primary)",
    fontSize: "var(--text-sm)",
    outline: "none",
  },
  errorText: {
    margin: 0,
    fontSize: "var(--text-xs)",
    color: "#dc2626",
    fontWeight: 500,
  },
  submitBtn: {
    padding: "var(--space-2.5)",
    background: "var(--color-primary)",
    color: "white",
    fontWeight: 700,
    fontSize: "var(--text-sm)",
    border: "none",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    transition: "background 0.2s",
    marginTop: "var(--space-1)",
    minHeight: "40px",
  },
  authWrapper: {
    textAlign: "center",
    padding: "var(--space-4) 0",
  },
  txNotification: {
    background: "var(--color-primary-light)",
    color: "var(--color-primary)",
    border: "1px solid var(--color-primary)",
    borderRadius: "var(--radius-lg)",
    padding: "var(--space-3) var(--space-4)",
    fontSize: "var(--text-sm)",
    fontWeight: 600,
    maxWidth: "1100px",
    margin: "0 auto var(--space-6)",
    display: "flex",
    alignItems: "center",
  },
};
