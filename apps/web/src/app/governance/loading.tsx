export function ProposalListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div
      className="space-y-4"
      role="status"
      aria-label="Loading proposals"
      data-testid="governance-skeleton"
    >
      {Array.from({ length: count }, (_, idx) => (
        <div
          key={idx}
          className="h-56 animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--muted)]/50 p-6"
          aria-hidden="true"
        >
          <div className="mb-3 h-5 w-1/3 rounded bg-[var(--muted)]" />
          <div className="mb-2 h-4 w-5/6 rounded bg-[var(--muted)]" />
          <div className="h-4 w-2/3 rounded bg-[var(--muted)]" />
        </div>
      ))}
    </div>
  );
}

export default function GovernanceLoading() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8" data-testid="governance-loading">
      <div className="mb-6 h-10 w-48 animate-pulse rounded-lg bg-[var(--muted)]/60" />
      <ProposalListSkeleton count={3} />
    </main>
  );
}
