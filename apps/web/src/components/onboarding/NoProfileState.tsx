// State 3b: Connected + funded, but no profile yet
export function NoProfileState() {
  return (
    <div className="flex flex-col items-center text-center gap-6">
      <div className="text-5xl">🪪</div>
      <div>
        <h2 className="text-2xl font-bold mb-2">Create Your Profile</h2>
        <p className="text-[var(--text-muted)] max-w-xs">
          Your wallet is connected. Set up your Linkora creator profile to start
          posting and earning tips.
        </p>
      </div>
      <a href="/profile/edit" className="btn-primary">
        Create Profile
      </a>
    </div>
  );
}
