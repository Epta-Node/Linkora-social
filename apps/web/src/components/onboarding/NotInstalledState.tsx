// State 1: Freighter not installed
export function NotInstalledState() {
  return (
    <div className="flex flex-col items-center text-center gap-6">
      <div className="text-5xl">🔌</div>
      <div>
        <h2 className="text-2xl font-bold mb-2">Freighter Wallet Required</h2>
        <p className="text-[var(--text-muted)] max-w-xs">
          Linkora uses Freighter to sign transactions on Stellar. Install the
          browser extension to get started.
        </p>
      </div>
      <a
        href="https://freighter.app"
        target="_blank"
        rel="noopener noreferrer"
        className="btn-primary"
      >
        Install Freighter
      </a>
      <p className="text-xs text-[var(--text-muted)]">
        After installing, refresh this page.
      </p>
    </div>
  );
}
