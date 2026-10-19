"use client";

import { useState, useEffect } from "react";
import { LinkoraClient } from "linkora-sdk";
import type { GovProposal, GovConfig, GovStatus, GovParameter } from "linkora-sdk";
import { useWallet } from "@/hooks/useWallet";
import { buildSignAndSubmit } from "@/lib/tx";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";

interface Proposal {
  id: string;
  title: string;
  status: "open" | "executed" | "vetoed" | "passed" | "failed";
  votesFor: number;
  votesAgainst: number;
  endDate: Date;
  parameter: GovParameter;
  newValue: bigint;
  proposer: string;
}

interface GovernanceSectionProps {
  address: string;
}

const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || "CDUMMY";
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || "Test SDF Network ; September 2015";

function getGovernanceClient(): LinkoraClient {
  return new LinkoraClient({ contractId: CONTRACT_ID, rpcUrl: RPC_URL });
}

function mapGovStatus(status: GovStatus): "open" | "executed" | "vetoed" | "passed" | "failed" {
  switch (status) {
    case "Active":
      return "open";
    case "Executed":
      return "executed";
    case "Vetoed":
      return "vetoed";
    case "Passed":
      return "passed";
    case "Failed":
      return "failed";
    default:
      return "open";
  }
}

function formatProposalTitle(parameter: GovParameter, newValue: bigint): string {
  switch (parameter) {
    case "FeeBps":
      return `Change platform fee to ${Number(newValue) / 100}%`;
    case "Treasury":
      return "Update treasury address";
    case "TipCooldownWindow":
      return `Set tip cooldown to ${newValue} ledgers`;
    case "GovQuorum":
      return `Change governance quorum to ${newValue}%`;
    case "GovTimeLock":
      return `Set governance time lock to ${newValue} ledgers`;
    case "GovVoteWindow":
      return `Set vote window to ${newValue} ledgers`;
    case "ModerationSlashBps":
      return `Change moderation slash to ${Number(newValue) / 100}%`;
    default:
      return `Proposal for ${parameter}`;
  }
}

export function GovernanceSection({ address }: GovernanceSectionProps) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [govConfig, setGovConfig] = useState<GovConfig | null>(null);
  const [votingOnId, setVotingOnId] = useState<string | null>(null);
  const [voteError, setVoteError] = useState<Record<string, string>>({});
  const { address: walletAddress } = useWallet();

  useEffect(() => {
    async function loadProposals() {
      try {
        setLoading(true);
        setError(null);
        const client = getGovernanceClient();

        // Load governance config
        const config = await client.govGetConfig();
        setGovConfig(config);

        // Fetch proposal count and load all proposals
        // Note: Contract doesn't expose proposal count directly, so we try fetching
        // proposals sequentially until we hit an error
        const loadedProposals: Proposal[] = [];
        let proposalId = 1n;
        const maxProposalsToCheck = 100; // Safety limit

        for (let i = 0; i < maxProposalsToCheck; i++) {
          try {
            const govProposal = await client.govGetProposal(proposalId);
            const status = mapGovStatus(govProposal.status);

            // Only show open proposals
            if (status === "open") {
              // Calculate end date based on created_ledger + vote_window_ledgers
              // Estimate: ~5 seconds per ledger
              const voteWindowSeconds = config.vote_window_ledgers * 5;
              const createdDate = new Date(govProposal.created_ledger * 5 * 1000);
              const endDate = new Date(createdDate.getTime() + voteWindowSeconds * 1000);

              loadedProposals.push({
                id: govProposal.id.toString(),
                title: formatProposalTitle(govProposal.parameter, govProposal.new_value),
                status,
                votesFor: govProposal.votes_for,
                votesAgainst: govProposal.votes_against,
                endDate,
                parameter: govProposal.parameter,
                newValue: govProposal.new_value,
                proposer: govProposal.proposer,
              });
            }

            proposalId++;
          } catch (err) {
            // No more proposals
            break;
          }
        }

        setProposals(loadedProposals);
      } catch (err) {
        console.error("Failed to load proposals:", err);
        setError("Failed to load governance proposals. Please try again later.");
      } finally {
        setLoading(false);
      }
    }
    loadProposals();
  }, [address]);

  }, [address]);

  async function handleVote(proposalId: string, support: boolean) {
    if (!walletAddress) {
      setVoteError({ ...voteError, [proposalId]: "Please connect your wallet to vote" });
      return;
    }

    setVotingOnId(proposalId);
    setVoteError({ ...voteError, [proposalId]: "" });

    try {
      const client = getGovernanceClient();
      const xdr = client.govVote(walletAddress, BigInt(proposalId), support);

      await buildSignAndSubmit(
        "gov_vote",
        [
          Address.fromString(walletAddress).toScVal(),
          nativeToScVal(BigInt(proposalId), { type: "u64" }),
          nativeToScVal(support, { type: "bool" }),
        ],
        walletAddress,
        {
          contractId: CONTRACT_ID,
          rpcUrl: RPC_URL,
          networkPassphrase: NETWORK_PASSPHRASE,
        }
      );

      // Reload proposals after successful vote
      const updatedProposal = await client.govGetProposal(BigInt(proposalId));
      setProposals((prev) =>
        prev.map((p) =>
          p.id === proposalId
            ? {
                ...p,
                votesFor: updatedProposal.votes_for,
                votesAgainst: updatedProposal.votes_against,
                status: mapGovStatus(updatedProposal.status),
              }
            : p
        )
      );
    } catch (err: any) {
      console.error("Vote failed:", err);
      let errorMessage = "Failed to submit vote. Please try again.";

      // Check for specific error cases
      const errStr = err?.message || String(err);
      if (errStr.includes("AlreadyVoted") || errStr.includes("already voted")) {
        errorMessage = "You have already voted on this proposal.";
      } else if (errStr.includes("VoteWindowClosed") || errStr.includes("vote window")) {
        errorMessage = "The voting window for this proposal has closed.";
      }

      setVoteError({ ...voteError, [proposalId]: errorMessage });
    } finally {
      setVotingOnId(null);
    }
  }

  function formatTimeRemaining(endDate: Date): string {
    const now = new Date();
    const diff = endDate.getTime() - now.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days > 0) return `${days}d ${hours}h remaining`;
    if (hours > 0) return `${hours}h remaining`;
    return "Ending soon";
  }

  if (loading) {
    return (
      <section className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Governance</h2>
        <p className="text-gray-500 dark:text-gray-400">Loading active proposals...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Governance</h2>
        <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Governance</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        View and participate in active proposals affecting your creator token.
      </p>

      {proposals.length === 0 ? (
        <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg text-center">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No active proposals at the moment.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map((proposal) => (
            <div
              key={proposal.id}
              className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-violet-300 dark:hover:border-violet-600 transition-colors"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {proposal.title}
                </h3>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    proposal.status === "open"
                      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                      : proposal.status === "passed" || proposal.status === "executed"
                        ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                        : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                  }`}
                >
                  {proposal.status}
                </span>
              </div>

              <div className="flex items-center gap-4 mb-3">
                <div className="flex-1">
                  <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                    <span>For: {proposal.votesFor}</span>
                    <span>Against: {proposal.votesAgainst}</span>
                  </div>
                  <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 dark:bg-green-600"
                      style={{
                        width: `${
                          proposal.votesFor + proposal.votesAgainst === 0
                            ? 0
                            : (proposal.votesFor / (proposal.votesFor + proposal.votesAgainst)) *
                              100
                        }%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              {voteError[proposal.id] && (
                <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 rounded text-xs text-red-600 dark:text-red-400">
                  {voteError[proposal.id]}
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {formatTimeRemaining(proposal.endDate)}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleVote(proposal.id, true)}
                    disabled={votingOnId === proposal.id || !walletAddress}
                    className="px-3 py-1 text-xs font-medium text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed rounded transition-colors"
                  >
                    {votingOnId === proposal.id ? "Voting..." : "Support"}
                  </button>
                  <button
                    onClick={() => handleVote(proposal.id, false)}
                    disabled={votingOnId === proposal.id || !walletAddress}
                    className="px-3 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed rounded transition-colors"
                  >
                    {votingOnId === proposal.id ? "Voting..." : "Oppose"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <a
          href="/governance"
          className="text-sm text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300 font-medium"
        >
          View All Proposals →
        </a>
      </div>
    </section>
  );
}
