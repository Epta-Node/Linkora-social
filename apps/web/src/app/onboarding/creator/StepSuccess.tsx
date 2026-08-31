"use client";

const STELLAR_EXPERT_BASE = "https://stellar.expert/explorer/testnet/contract";

interface Props {
  walletAddress: string;
  tokenAddress: string;
}

export function StepSuccess({ walletAddress, tokenAddress }: Props) {
  const explorerUrl = `${STELLAR_EXPERT_BASE}/${tokenAddress}`;
  const profileUrl = `/profile/${walletAddress}`;
  const shareText = encodeURIComponent(
    `I just launched my creator token on @LinkoraSocial! Check my profile: https://linkora.xyz/profile/${walletAddress}`
  );
  const twitterUrl = `https://twitter.com/intent/tweet?text=${shareText}`;

  return (
    <div className="flex flex-col items-center text-center gap-6" data-testid="step-success">
      <div className="text-6xl">🎉</div>

      <div>
        <h2 className="text-2xl font-bold mb-2">Token deployed!</h2>
        <p className="text-sm text-[var(--text-muted)] max-w-xs">
          Your creator token is live on Stellar Testnet and your profile is registered.
        </p>
      </div>

      {/* Token address */}
      <div
        className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-4 text-left"
        aria-label="Token address"
      >
        <p className="text-xs text-[var(--text-muted)] uppercase tracking-widest mb-1">
          Token address
        </p>
        <p className="font-mono text-xs text-violet-300 break-all" data-testid="token-address">
          {tokenAddress}
        </p>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 underline underline-offset-2"
          data-testid="stellar-expert-link"
        >
          View on Stellar Expert ↗
        </a>
      </div>

      {/* CTAs */}
      <div className="w-full flex flex-col gap-3">
        <a href={profileUrl} className="btn-primary" data-testid="view-profile-cta">
          View your profile
        </a>
        <a
          href={twitterUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="py-2 rounded-xl border border-[var(--border)] text-sm text-[var(--text-muted)] hover:border-violet-500 hover:text-white transition text-center"
          data-testid="share-cta"
        >
          Share your profile
        </a>
      </div>
    </div>
  );
}
