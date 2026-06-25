"use client";

import { useState, useEffect } from "react";

interface Proposal {
  id: string;
  title: string;
  status: "active" | "passed" | "rejected";
  votesFor: number;
  votesAgainst: number;
  endDate: Date;
}

interface GovernanceSectionProps {
  address: string;
}

export function GovernanceSection({ address }: GovernanceSectionProps) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProposals() {
      try {
        // TODO: Implement actual governance contract calls
        // For now, using mock data
        const mockProposals: Proposal[] = [
          {
            id: "1",
            title: "Reduce platform fee from 2.5% to 2%",
            status: "active",
            votesFor: 1250,
            votesAgainst: 430,
            endDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
          },
          {
            id: "2",
            title: "Add support for custom tokens in pools",
            status: "active",
            votesFor: 980,
            votesAgainst: 120,
            endDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          },
        ];
        setProposals(mockProposals);
      } catch (error) {
        console.error("Failed to load proposals:", error);
      } finally {
        setLoading(false);
      }
    }
    loadProposals();
  }, [address]);

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
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-xl font-semibold mb-4">Governance</h2>
        <p className="text-gray-500">Loading active proposals...</p>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-xl font-semibold mb-4">Governance</h2>
      <p className="text-sm text-gray-600 mb-4">
        View and participate in active proposals affecting your creator token.
      </p>

      {proposals.length === 0 ? (
        <div className="p-4 bg-gray-50 rounded-lg text-center">
          <p className="text-sm text-gray-600">No active proposals at the moment.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map((proposal) => (
            <div
              key={proposal.id}
              className="p-4 border border-gray-200 rounded-lg hover:border-violet-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className="text-sm font-medium text-gray-900">{proposal.title}</h3>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    proposal.status === "active"
                      ? "bg-green-100 text-green-800"
                      : proposal.status === "passed"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-red-100 text-red-800"
                  }`}
                >
                  {proposal.status}
                </span>
              </div>

              <div className="flex items-center gap-4 mb-2">
                <div className="flex-1">
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span>For: {proposal.votesFor}</span>
                    <span>Against: {proposal.votesAgainst}</span>
                  </div>
                  <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500"
                      style={{
                        width: `${(proposal.votesFor / (proposal.votesFor + proposal.votesAgainst)) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  {formatTimeRemaining(proposal.endDate)}
                </span>
                <a
                  href={`/governance/${proposal.id}`}
                  className="text-sm text-violet-600 hover:text-violet-700 font-medium"
                >
                  Vote →
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-gray-200">
        <a href="/governance" className="text-sm text-violet-600 hover:text-violet-700 font-medium">
          View All Proposals →
        </a>
      </div>
    </section>
  );
}
