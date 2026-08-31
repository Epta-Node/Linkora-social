"use client";

import { useEffect, useState } from "react";
import { useWalletContext } from "@/components/WalletProvider";
import { LinkoraClient, GovParameter, GovProposal, GovStatus } from "linkora-sdk";

const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";

type ProposalWithQuorum = GovProposal & { effectiveQuorum: number };
const GOVERNANCE_PARAMETERS = Object.values(GovParameter) as GovParameter[];

export default function GovernancePage() {
  const { address, connected } = useWalletContext();
  const [proposals, setProposals] = useState<ProposalWithQuorum[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"Active" | "Passed" | "Executed" | "History">(
    "Active"
  );

  // Form state
  const [formParam, setFormParam] = useState<GovParameter>(GovParameter.FeeBps);
  const [formValue, setFormValue] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchProposals = async () => {
    if (!CONTRACT_ID) return;
    setLoading(true);
    try {
      const client = new LinkoraClient({ rpcUrl: RPC_URL, contractId: CONTRACT_ID });
      const fetched: ProposalWithQuorum[] = [];
      let id = 1n;
      while (true) {
        try {
          const prop = await client.govGetProposal(id);
          const quorum = await client.effectiveQuorum(id);
          fetched.push({ ...prop, effectiveQuorum: quorum });
          id++;
        } catch (e) {
          // If it throws, we've likely hit the end of the proposals
          break;
        }
      }
      setProposals(fetched.reverse()); // Newest first
    } catch (e) {
      console.error("Failed to fetch proposals", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProposals();
  }, []);

  const handlePropose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || !CONTRACT_ID) return;
    setIsSubmitting(true);
    try {
      const client = new LinkoraClient({ rpcUrl: RPC_URL, contractId: CONTRACT_ID });
      await client.govPropose(address, formParam, BigInt(formValue), null);
      setFormValue("");
      await fetchProposals();
    } catch (error) {
      console.error("Failed to propose", error);
      alert("Failed to create proposal");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVote = async (proposalId: bigint, support: boolean) => {
    if (!address || !CONTRACT_ID) return;
    try {
      const client = new LinkoraClient({ rpcUrl: RPC_URL, contractId: CONTRACT_ID });
      await client.govVote(address, proposalId, support);
      await fetchProposals();
    } catch (error) {
      console.error("Failed to vote", error);
      alert("Failed to vote");
    }
  };

  const handleExecute = async (proposalId: bigint) => {
    if (!CONTRACT_ID) return;
    try {
      const client = new LinkoraClient({ rpcUrl: RPC_URL, contractId: CONTRACT_ID });
      await client.govExecute(proposalId);
      await fetchProposals();
    } catch (error) {
      console.error("Failed to execute", error);
      alert("Failed to execute proposal. Time-lock might not have expired yet.");
    }
  };

  const activeProposals = proposals.filter((p) => p.status === GovStatus.Active);
  const passedProposals = proposals.filter((p) => p.status === GovStatus.Passed);
  const executedProposals = proposals.filter((p) => p.status === GovStatus.Executed);

  let displayedProposals = activeProposals;
  if (activeTab === "Passed") displayedProposals = passedProposals;
  if (activeTab === "Executed") displayedProposals = executedProposals;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[var(--foreground)] mb-2">Governance</h1>
        <p className="text-[var(--text-muted)]">
          Participate in the protocol&apos;s parameter management.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="flex space-x-2 border-b border-[var(--border)] pb-2 overflow-x-auto">
            {(["Active", "Passed", "Executed", "History"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  activeTab === tab
                    ? "bg-[var(--muted)] text-violet-400 border-b-2 border-violet-500"
                    : "text-[var(--text-muted)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]/50"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="py-12 text-center text-[var(--text-muted)] animate-pulse">
              Loading proposals...
            </div>
          ) : activeTab === "History" ? (
            <div className="space-y-4">
              {executedProposals.length === 0 ? (
                <div className="py-8 text-center text-[var(--text-muted)] border border-[var(--border)] rounded-xl bg-[var(--muted)]/20">
                  No parameter change history.
                </div>
              ) : (
                executedProposals.map((p) => (
                  <div
                    key={p.id.toString()}
                    className="flex justify-between items-center p-4 border border-[var(--border)] rounded-xl bg-[var(--muted)]/40"
                  >
                    <div>
                      <p className="font-semibold text-[var(--foreground)]">{p.parameter}</p>
                      <p className="text-sm text-[var(--text-muted)]">
                        Changed to {p.new_value.toString()}
                      </p>
                    </div>
                    <div className="text-sm font-mono text-[var(--text-muted)]">
                      Ledger {p.created_ledger}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {displayedProposals.length === 0 ? (
                <div className="py-8 text-center text-[var(--text-muted)] border border-[var(--border)] rounded-xl bg-[var(--muted)]/20">
                  No {activeTab.toLowerCase()} proposals.
                </div>
              ) : (
                displayedProposals.map((p) => (
                  <div
                    key={p.id.toString()}
                    className="border border-[var(--border)] rounded-xl p-5 bg-[var(--background)] shadow-sm"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-bold text-[var(--foreground)]">
                          Proposal #{p.id.toString()}: Update {p.parameter}
                        </h3>
                        <p className="text-sm text-[var(--text-muted)] font-mono mt-1">
                          Proposer: {p.proposer.slice(0, 6)}…{p.proposer.slice(-4)}
                        </p>
                      </div>
                      <span className="px-3 py-1 text-xs font-semibold rounded-full bg-violet-900/40 text-violet-300 border border-violet-700/50">
                        {p.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                      <div className="p-3 rounded-lg bg-[var(--muted)]/40 border border-[var(--border)]">
                        <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">
                          New Value
                        </p>
                        <p className="text-lg font-semibold text-[var(--foreground)]">
                          {p.new_value.toString()}
                        </p>
                      </div>
                      <div className="p-3 rounded-lg bg-[var(--muted)]/40 border border-[var(--border)]">
                        <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">
                          Effective Quorum
                        </p>
                        <p className="text-lg font-semibold text-[var(--foreground)]">
                          {p.effectiveQuorum}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex flex-wrap gap-4 text-sm font-medium">
                        <span className="text-green-500">For: {p.votes_for}</span>
                        <span className="text-red-500">Against: {p.votes_against}</span>
                      </div>

                      {connected && p.status === GovStatus.Active && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => handleVote(p.id, true)}
                            className="flex-1 sm:flex-none px-4 py-2 bg-green-600/20 text-green-500 hover:bg-green-600/30 border border-green-600/50 rounded-lg transition-colors text-sm font-medium"
                          >
                            Vote For
                          </button>
                          <button
                            onClick={() => handleVote(p.id, false)}
                            className="flex-1 sm:flex-none px-4 py-2 bg-red-600/20 text-red-500 hover:bg-red-600/30 border border-red-600/50 rounded-lg transition-colors text-sm font-medium"
                          >
                            Vote Against
                          </button>
                        </div>
                      )}

                      {connected && p.status === GovStatus.Passed && (
                        <button
                          onClick={() => handleExecute(p.id)}
                          className="w-full sm:w-auto px-4 py-2 bg-violet-600 text-white hover:bg-violet-500 rounded-lg transition-colors text-sm font-semibold shadow-md"
                        >
                          Execute
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="border border-[var(--border)] rounded-xl p-5 bg-[var(--background)] shadow-sm sticky top-24">
            <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">Create Proposal</h2>

            {!connected ? (
              <p className="text-[var(--text-muted)] text-sm">
                Connect your wallet to create a proposal.
              </p>
            ) : (
              <form onSubmit={handlePropose} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">
                    Parameter
                  </label>
                  <select
                    value={formParam}
                    onChange={(e) => setFormParam(e.target.value as GovParameter)}
                    className="w-full bg-[var(--muted)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                  >
                    {GOVERNANCE_PARAMETERS.map((parameter) => (
                      <option key={parameter} value={parameter}>
                        {parameter}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">
                    New Value (Integer)
                  </label>
                  <input
                    type="number"
                    required
                    value={formValue}
                    onChange={(e) => setFormValue(e.target.value)}
                    className="w-full bg-[var(--muted)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                    placeholder="1000"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-violet-600 text-white rounded-lg px-4 py-2 font-semibold hover:bg-violet-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                >
                  {isSubmitting ? "Proposing..." : "Submit Proposal"}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
