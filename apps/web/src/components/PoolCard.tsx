"use client";

import React from "react";

interface PoolCardProps {
  poolId: string;
  token: string;
  balance: bigint | number | string;
  adminCount: number;
  threshold: number;
}

export default function PoolCard({ poolId, token, balance, adminCount, threshold }: PoolCardProps) {
  const formattedBalance = (Number(balance) / 1e7).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  });

  return (
    <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-5 hover:border-neutral-500 transition-colors cursor-pointer shadow-md">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold text-white truncate" title={poolId}>
            {poolId}
          </h3>
          <span className="text-sm text-neutral-400 font-mono">{token}</span>
        </div>
        {/* M-of-N threshold badge */}
        <span
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-xs font-semibold whitespace-nowrap flex-shrink-0"
          title={`Requires ${threshold} of ${adminCount} admin signatures`}
        >
          {threshold} of {adminCount} admins
        </span>
      </div>

      <div className="flex items-center justify-between text-sm text-neutral-400 border-t border-neutral-700 pt-4">
        <span>Balance</span>
        <span className="font-semibold text-white">
          {formattedBalance} {token}
        </span>
      </div>
    </div>
  );
}
