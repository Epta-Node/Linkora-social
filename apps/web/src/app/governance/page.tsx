"use client";

import Link from "next/link";
import { ProposalCard } from "@/components/governance/ProposalCard";
import { useProposalList } from "@/hooks/useGovernance";
import { isGovernanceConfigured } from "@/lib/governance";
import { ProposalListSkeleton } from "./loading";

export default function GovernancePage() {
  const { proposals, loading, error, page, hasNext, hasPrev, next, previous, refresh } =
    useProposalList();
  const sampleMode = !isGovernanceConfigured();

  return (
    <main className="mx-auto max-w-4xl px-4 py-8" data-testid="governance-page">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--foreground)]">Governance</h1>
          <p className="mt-1 text-[var(--text-muted)]">
            Review proposals, track votes, and help shape the protocol.
          </p>
        </div>
        <Link
          href="/governance/new"
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-violet-500"
        >
          + Create proposal
        </Link>
      </header>

      {sampleMode && (
        <p
          role="note"
          className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300"
        >
          Sample proposals are shown because no governance contract is configured for this
          environment.
        </p>
      )}

      <section aria-labelledby="proposal-list-heading" aria-busy={loading}>
        <h2 id="proposal-list-heading" className="sr-only">
          Proposals
        </h2>

        {error && (
          <div
            role="alert"
            className="mb-4 flex flex-col gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 sm:flex-row sm:items-center sm:justify-between dark:text-red-400"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={refresh}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-current px-3 font-medium"
            >
              Retry
            </button>
          </div>
        )}

        {loading && <ProposalListSkeleton count={3} />}

        {!loading && !error && proposals.length === 0 && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--muted)]/30 px-6 py-12 text-center">
            <p className="text-[var(--text-muted)]">No proposals have been created yet.</p>
            <Link
              href="/governance/new"
              className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-500"
            >
              Create the first proposal
            </Link>
          </div>
        )}

        {!loading && proposals.length > 0 && (
          <div className="space-y-4" aria-live="polite">
            {proposals.map((proposal) => (
              <ProposalCard key={proposal.id} proposal={proposal} />
            ))}
          </div>
        )}
      </section>

      {(hasPrev || hasNext) && !loading && (
        <nav
          aria-label="Proposal pagination"
          className="mt-6 flex items-center justify-between gap-4"
        >
          <button
            type="button"
            onClick={previous}
            disabled={!hasPrev}
            className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] px-4 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-[var(--text-muted)]" aria-live="polite">
            Page {page}
          </span>
          <button
            type="button"
            onClick={next}
            disabled={!hasNext}
            className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] px-4 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}
    </main>
  );
}
