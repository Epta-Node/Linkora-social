"use client";

const FRIENDBOT_URL = "https://friendbot.stellar.org";

// State 3a: Connected, zero balance — fund first
export function FundWalletState({
  address,
  onFunded,
}: {
  address: string;
  onFunded: () => void;
}) {
  async function handleFriendbot() {
    await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(address)}`);
    onFunded();
  }

  return (
    <div className="flex flex-col items-center text-center gap-6">
      <div className="text-5xl">💸</div>
      <div>
        <h2 className="text-2xl font-bold mb-2">Fund Your Testnet Wallet</h2>
        <p className="text-[var(--text-muted)] max-w-xs">
          Your wallet has no XLM. Use the Friendbot faucet to get testnet funds
          so you can create a profile and interact with Linkora.
        </p>
        <p className="mt-3 font-mono text-xs text-[var(--text-muted)] break-all">
          {address}
        </p>
      </div>
      <button onClick={handleFriendbot} className="btn-primary">
        Fund with Friendbot
      </button>
      <button onClick={onFunded} className="text-sm text-[var(--text-muted)] underline">
        I already have funds →
      </button>
    </div>
  );
}
