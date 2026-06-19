"use client";

interface TokenPreviewCardProps {
  name: string;
  symbol: string;
  decimals: number;
  initialSupply: string;
  deployerAddress: string;
}

export function TokenPreviewCard({
  name,
  symbol,
  decimals,
  initialSupply,
  deployerAddress,
}: TokenPreviewCardProps) {
  const displaySupply = initialSupply ? Number(initialSupply).toLocaleString() : "—";

  return (
    <div
      aria-label="Token preview"
      className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-violet-600 flex items-center justify-center text-white font-bold text-base">
          {symbol ? symbol.charAt(0).toUpperCase() : "?"}
        </div>
        <div>
          <p className="font-semibold text-gray-900">{name || "Your Token"}</p>
          <p className="text-gray-500 text-xs">{symbol || "SYM"}</p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
        <dt className="font-medium">Decimals</dt>
        <dd>{decimals}</dd>
        <dt className="font-medium">Initial Supply</dt>
        <dd>{displaySupply}</dd>
        <dt className="font-medium">Admin</dt>
        <dd className="font-mono truncate">{deployerAddress.slice(0, 8)}…</dd>
      </dl>
    </div>
  );
}
