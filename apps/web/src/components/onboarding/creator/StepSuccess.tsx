"use client";

interface Props {
  tokenAddress: string;
  deployerAddress: string;
}

const STELLAR_EXPERT_BASE = "https://stellar.expert/explorer/testnet/contract";

export function StepSuccess({ tokenAddress, deployerAddress }: Props) {
  const expertUrl = `${STELLAR_EXPERT_BASE}/${tokenAddress}`;
  const profileUrl = `/profile/${deployerAddress}`;

  return (
    <div className="text-center">
      <div
        className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4"
        aria-hidden="true"
      >
        <span className="text-3xl">🎉</span>
      </div>

      <h2 className="text-xl font-bold mb-1">Token deployed!</h2>
      <p className="text-sm text-gray-500 mb-6">
        Your creator token is live on Stellar and linked to your Linkora profile.
      </p>

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6 text-left">
        <p className="text-xs text-gray-500 font-medium mb-1">Token address</p>
        <p
          className="font-mono text-sm break-all text-gray-800"
          aria-label="Deployed token contract address"
        >
          {tokenAddress}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <a
          href={expertUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 border border-violet-500 text-violet-600 text-sm font-medium rounded-lg hover:bg-violet-50 focus:outline-none focus:ring-2 focus:ring-violet-500"
        >
          View on Stellar Expert ↗
        </a>
        <a
          href={profileUrl}
          className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500"
          data-testid="share-profile-cta"
        >
          Share your profile
        </a>
      </div>
    </div>
  );
}
