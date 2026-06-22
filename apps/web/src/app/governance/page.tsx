"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useWallet } from "@/hooks/useWallet";
import { LinkoraClient } from "linkora-sdk";

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

export default function GovernancePage() {
  const { address, connected } = useWallet();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [txMessage, setTxMessage] = useState<string | null>(null);

  const [config, setConfig] = useState<GovConfig>({
    quorum: 60,
    time_lock_ledgers: 100,
    vote_window_ledgers: 200,
    quorum_decay_rate_bps: 50,
    quorum_floor: 30,
  });

  const [proposals, setProposals] = useState<GovProposal[]>([]);
  const [votedProposalIds, setVotedProposalIds] = useState<number[]>([]);

  // Form states
  const [parameter, setParameter] = useState<GovParameter>("FeeBps");
  const [newValue, setNewValue] = useState<string>("");
  const [newAddress, setNewAddress] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);

  // Fetch initial data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch Config
      const configRes = await fetch("/api/governance/config");
      if (configRes.ok) {
        const configData = await configRes.json();
        setConfig(configData);
      }

      // 2. Fetch Proposals
      const proposalsRes = await fetch("/api/governance/proposals");
      if (proposalsRes.ok) {
        const proposalsData = await proposalsRes.json();
        setProposals(proposalsData);
      }
    } catch (err) {
      console.error("Error loading governance data:", err);
      setError("Failed to sync with governance smart contract data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Veto authorization check
  const isAdmin = connected && address && ADMINS.includes(address);

  // Vote handler
  const handleVote = useCallback(
    async (proposalId: number, support: boolean) => {
      if (!connected || !address) return;

      setTxMessage("Awaiting Freighter signature...");
      try {
        const res = await fetch("/api/governance/proposals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "vote",
            proposalId,
            support,
            voter: address,
          }),
        });

        if (!res.ok) {
          throw new Error("Failed to register vote on API");
        }

        const data = await res.json();
        if (data.success) {
          // Update local state optimistically
          setProposals((prev) =>
            prev.map((p) => (p.id === proposalId ? data.proposal : p))
          );
          setVotedProposalIds((prev) => [...prev, proposalId]);
        }
      } catch (err) {
        console.error("Voting error:", err);
        alert("Failed to submit vote. Please try again.");
      } finally {
        setTxMessage(null);
      }
    },
    [connected, address]
  );

  // Veto handler (admin-only)
  const handleVeto = useCallback(
    async (proposalId: number) => {
      if (!isAdmin) return;

      setTxMessage("Awaiting Freighter signature (Admin Veto)...");
      try {
        const res = await fetch("/api/governance/proposals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "veto",
            proposalId,
          }),
        });

        if (!res.ok) {
          throw new Error("Failed to submit veto to API");
        }

        const data = await res.json();
        if (data.success) {
          setProposals((prev) =>
            prev.map((p) => (p.id === proposalId ? data.proposal : p))
          );
        }
      } catch (err) {
        console.error("Veto error:", err);
        alert("Failed to veto proposal.");
      } finally {
        setTxMessage(null);
      }
    },
    [isAdmin]
  );

  // Proposal creation handler
  const handleCreateProposal = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setFormError(null);

      if (!connected || !address) {
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

      setTxMessage("Awaiting Freighter signature...");
      try {
        const res = await fetch("/api/governance/proposals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            proposer: address,
            parameter,
            newValue: parameter === "Treasury" ? 0 : Number(newValue),
            newAddress: parameter === "Treasury" ? newAddress : null,
          }),
        });

        if (!res.ok) {
          throw new Error("Failed to create proposal");
        }

        const data = await res.json();
        if (data.success) {
          setProposals((prev) => [...prev, data.proposal]);
          setNewValue("");
          setNewAddress("");
        }
      } catch (err) {
        console.error("Proposal creation error:", err);
        setFormError("Failed to create proposal. Please try again.");
      } finally {
        setTxMessage(null);
      }
    },
    [connected, address, parameter, newValue, newAddress]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center text-slate-400">
        <div className="w-12 h-12 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-sm font-semibold tracking-wide animate-pulse">Syncing Governance ledger...</p>
      </div>
    );
  }

  const activeProposals = proposals.filter((p) => p.status === "Active");
  const executedProposals = proposals.filter(
    (p) => p.status === "Executed" || p.status === "Vetoed" || p.status === "Failed"
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 py-12 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        {/* Page Header */}
        <header className="mb-10 text-center md:text-left">
          <h1 className="text-4xl font-extrabold tracking-tight text-white mb-2 bg-gradient-to-r from-violet-400 to-indigo-300 bg-clip-text text-transparent">
            On-Chain Governance
          </h1>
          <p className="text-slate-400 max-w-2xl text-base leading-relaxed">
            Submit parameter proposals and cast support or reject votes. All parameter adjustments execute transparently after timelocks.
          </p>
        </header>

        {/* Transaction Overlay Status Banner */}
        {txMessage && (
          <div className="mb-8 p-4 bg-violet-950/80 border border-violet-500/30 rounded-xl flex items-center gap-3 backdrop-blur-md shadow-lg shadow-violet-950/20 animate-pulse">
            <span className="text-lg">⏳</span>
            <span className="text-sm font-semibold tracking-wide text-violet-200">{txMessage}</span>
          </div>
        )}

        {error && (
          <div className="mb-8 p-4 bg-red-950/80 border border-red-500/30 rounded-xl flex items-center gap-3 text-red-200 backdrop-blur-md">
            <span>⚠️</span>
            <span className="text-sm">{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Active Proposals List (Col span 2) */}
          <section className="md:col-span-2 space-y-6">
            <h2 className="text-xl font-bold tracking-tight text-white border-b border-slate-800 pb-3">
              Active Proposals
            </h2>

            {activeProposals.length === 0 ? (
              <div className="p-8 bg-slate-900/40 border border-slate-800/80 rounded-2xl text-center text-slate-500">
                No active governance proposals currently open.
              </div>
            ) : (
              <div className="space-y-4">
                {activeProposals.map((proposal) => {
                  const votesForPctOfSupply = (proposal.votes_for / TOTAL_SUPPLY) * 100;
                  const quorumProgress =
                    config.quorum > 0
                      ? Math.min((votesForPctOfSupply / config.quorum) * 100, 100)
                      : 100;
                  const hasVoted = votedProposalIds.includes(proposal.id);

                  return (
                    <article
                      key={proposal.id}
                      className="p-6 bg-slate-900/60 border border-slate-800/80 hover:border-slate-700/80 rounded-2xl transition-all shadow-md"
                    >
                      <div className="flex justify-between items-start mb-4">
                        <span className="px-3 py-1 bg-violet-950 text-violet-300 border border-violet-800/60 rounded-lg text-xs font-bold uppercase tracking-wider">
                          {proposal.parameter}
                        </span>
                        <span className="text-xs font-semibold text-slate-500">
                          ID: #{proposal.id}
                        </span>
                      </div>

                      <div className="space-y-2 mb-6 text-sm">
                        <p className="text-slate-300">
                          <strong className="text-slate-400 font-medium mr-2">Proposed change:</strong>
                          <span className="font-mono text-white">
                            {proposal.parameter === "Treasury"
                              ? proposal.new_address
                              : proposal.new_value}
                          </span>
                        </p>
                        <p className="text-slate-300 flex items-center">
                          <strong className="text-slate-400 font-medium mr-2">Proposer:</strong>
                          <span
                            className="font-mono text-xs text-slate-500 truncate max-w-[200px]"
                            title={proposal.proposer}
                          >
                            {proposal.proposer}
                          </span>
                        </p>
                        <p className="text-slate-300">
                          <strong className="text-slate-400 font-medium mr-2">Ends In:</strong>
                          <span className="text-slate-400">~150 ledgers</span>
                        </p>
                      </div>

                      {/* Quorum indicator */}
                      <div className="mb-6">
                        <div className="flex justify-between text-xs font-medium text-slate-400 mb-2">
                          <span>Quorum Indicator</span>
                          <span>
                            {votesForPctOfSupply.toFixed(1)}% / {config.quorum}% Target
                          </span>
                        </div>
                        <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden">
                          <div
                            className="bg-gradient-to-r from-violet-600 to-indigo-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${quorumProgress}%` }}
                          ></div>
                        </div>
                      </div>

                      {/* Votes weight summary */}
                      <div className="flex justify-between items-center text-xs font-semibold mb-6">
                        <span className="text-emerald-400">👍 For: {proposal.votes_for.toLocaleString()}</span>
                        <span className="text-red-400">👎 Against: {proposal.votes_against.toLocaleString()}</span>
                      </div>

                      {/* Voting buttons */}
                      {connected ? (
                        <div className="flex flex-wrap gap-3">
                          <button
                            onClick={() => handleVote(proposal.id, true)}
                            disabled={hasVoted}
                            className="flex-1 min-h-[40px] px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed font-semibold text-sm rounded-xl transition-colors shadow-lg shadow-emerald-950/20"
                          >
                            Vote For
                          </button>
                          <button
                            onClick={() => handleVote(proposal.id, false)}
                            disabled={hasVoted}
                            className="flex-1 min-h-[40px] px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed font-semibold text-sm rounded-xl transition-colors shadow-lg shadow-red-950/20"
                          >
                            Vote Against
                          </button>
                          {isAdmin && (
                            <button
                              onClick={() => handleVeto(proposal.id)}
                              className="px-4 py-2 bg-amber-700 hover:bg-amber-600 font-semibold text-sm rounded-xl transition-colors"
                            >
                              Veto Proposal
                            </button>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs font-medium text-amber-500">
                          ⚠️ Connect your wallet to vote.
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            {/* Executed History */}
            <h2 className="text-xl font-bold tracking-tight text-white border-b border-slate-800 pb-3 pt-6">
              Executed History
            </h2>

            {executedProposals.length === 0 ? (
              <div className="p-8 bg-slate-900/40 border border-slate-800/80 rounded-2xl text-center text-slate-500">
                No past transactions in history.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {executedProposals.map((proposal) => (
                  <article
                    key={proposal.id}
                    className="p-5 bg-slate-900/40 border border-slate-850 rounded-2xl opacity-75"
                  >
                    <div className="flex justify-between items-center mb-3">
                      <span className="px-2 py-0.5 bg-slate-850 border border-slate-700 text-slate-300 rounded text-xs font-semibold uppercase">
                        {proposal.parameter}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold ${
                          proposal.status === "Executed"
                            ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/30"
                            : "bg-amber-950/60 text-amber-400 border border-amber-800/30"
                        }`}
                      >
                        {proposal.status}
                      </span>
                    </div>

                    <div className="space-y-1.5 text-xs text-slate-400">
                      <p>
                        <strong>Value:</strong>{" "}
                        <span className="font-mono text-slate-200">
                          {proposal.parameter === "Treasury"
                            ? proposal.new_address
                            : proposal.new_value}
                        </span>
                      </p>
                      <p>
                        <strong>Proposer:</strong>{" "}
                        <span className="font-mono text-slate-500 truncate max-w-[200px]" title={proposal.proposer}>
                          {proposal.proposer}
                        </span>
                      </p>
                      <p>
                        <strong>Outcome:</strong> 👍 {proposal.votes_for.toLocaleString()} vs 👎{" "}
                        {proposal.votes_against.toLocaleString()}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Form Create Proposal Side Column */}
          <aside className="space-y-6">
            <div className="p-6 bg-slate-900/60 border border-slate-800/80 rounded-2xl shadow-md">
              <h2 className="text-lg font-bold tracking-tight text-white mb-4">
                Create Proposal
              </h2>

              {connected ? (
                <form onSubmit={handleCreateProposal} className="space-y-4">
                  <div>
                    <label htmlFor="proposal-parameter" className="block text-xs font-semibold text-slate-400 mb-1.5">
                      Parameter change
                    </label>
                    <select
                      id="proposal-parameter"
                      value={parameter}
                      onChange={(e) => {
                        setParameter(e.target.value as GovParameter);
                        setFormError(null);
                      }}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-sm focus:outline-none focus:border-violet-500"
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
                    <div>
                      <label htmlFor="proposal-treasury" className="block text-xs font-semibold text-slate-400 mb-1.5">
                        New Address
                      </label>
                      <input
                        id="proposal-treasury"
                        type="text"
                        placeholder="Stellar G... Address"
                        value={newAddress}
                        onChange={(e) => {
                          setNewAddress(e.target.value);
                          setFormError(null);
                        }}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-sm focus:outline-none focus:border-violet-500 font-mono"
                      />
                    </div>
                  ) : (
                    <div>
                      <label htmlFor="proposal-value" className="block text-xs font-semibold text-slate-400 mb-1.5">
                        New Value
                      </label>
                      <input
                        id="proposal-value"
                        type="number"
                        placeholder="Integer parameter value"
                        value={newValue}
                        onChange={(e) => {
                          setNewValue(e.target.value);
                          setFormError(null);
                        }}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-sm focus:outline-none focus:border-violet-500"
                      />
                    </div>
                  )}

                  {formError && <p className="text-xs font-medium text-red-400 mt-1">⚠️ {formError}</p>}

                  <button
                    type="submit"
                    className="w-full min-h-[44px] bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 font-bold text-sm text-white rounded-xl transition-all shadow-md shadow-violet-950/20"
                  >
                    Submit Proposal
                  </button>
                </form>
              ) : (
                <div className="text-center py-6">
                  <p className="text-xs font-medium text-slate-500 mb-3">
                    Connect your wallet to submit new proposals.
                  </p>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
