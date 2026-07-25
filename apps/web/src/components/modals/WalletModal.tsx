"use client";

import React, { useState, useEffect, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { X, Wallet, Copy, Check, Loader2, AlertCircle } from "lucide-react";
import { useTokenBalances, type TokenWithPrice } from "@/hooks/useTokenBalances";

export interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  address: string | null;
  network: string | null;
  onDisconnect: () => void;
}

function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatUsd(value: number | null): string {
  if (value === null) return "--";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

function TokenRow({ token }: { token: TokenWithPrice }) {
  const amount = parseFloat(token.balance) || 0;

  return (
    <div
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-gray-50 transition-colors"
      data-testid="token-row"
    >
      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
        <span className="text-xs font-bold text-white">{token.asset_code.slice(0, 2)}</span>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{token.asset_code}</p>
        {token.asset_issuer && (
          <p className="text-[11px] text-gray-400 truncate font-mono">
            {token.asset_issuer.slice(0, 8)}...{token.asset_issuer.slice(-4)}
          </p>
        )}
      </div>

      <div className="text-right shrink-0">
        <p className="text-sm font-medium text-gray-900">
          {amount.toLocaleString(undefined, { maximumFractionDigits: 7 })}
        </p>
        <p className="text-[11px] text-gray-500">{formatUsd(token.usdValue)}</p>
      </div>
    </div>
  );
}

export function WalletModal({ isOpen, onClose, address, network, onDisconnect }: WalletModalProps) {
  const [copied, setCopied] = useState(false);
  const { tokens, totalUsd, isLoading, error } = useTokenBalances(isOpen ? address : null);

  const handleCopy = useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.createElement("input");
      input.value = address;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [address]);

  const handleDisconnect = useCallback(() => {
    onDisconnect();
    onClose();
  }, [onDisconnect, onClose]);

  useEffect(() => {
    if (isOpen) {
      setCopied(false);
    }
  }, [isOpen]);

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AnimatePresence>
        {isOpen && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-50"
                style={{
                  backgroundColor: "rgba(59, 130, 246, 0.3)",
                  backdropFilter: "blur(8px)",
                }}
              />
            </Dialog.Overlay>

            <Dialog.Content asChild>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="fixed left-1/2 top-1/2 z-50 w-full max-w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-[16px] bg-white p-0 shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1)] focus:outline-none overflow-hidden"
                data-testid="wallet-modal"
              >
                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-5 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-blue-500 bg-blue-50">
                      <Wallet className="h-5 w-5 text-blue-600" />
                    </div>
                    <Dialog.Title className="text-lg font-bold text-gray-900">Wallet</Dialog.Title>
                  </div>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                      aria-label="Close wallet modal"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </Dialog.Close>
                </div>

                {/* Wallet Address */}
                <div className="px-5 pb-4">
                  <label className="mb-1.5 block text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Stellar Wallet Address
                  </label>
                  <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
                    <span className="text-blue-500 font-bold text-sm">+</span>
                    <span
                      className="flex-1 truncate text-sm font-mono text-gray-700"
                      title={address ?? ""}
                    >
                      {address ? formatAddress(address) : "Not connected"}
                    </span>
                    {address && (
                      <button
                        onClick={handleCopy}
                        className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors shrink-0"
                        aria-label="Copy wallet address"
                      >
                        {copied ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                  {network && (
                    <p className="mt-1.5 text-[11px] text-gray-400">
                      Network: <span className="font-medium text-gray-600">{network}</span>
                    </p>
                  )}
                </div>

                {/* Balance Header */}
                <div className="flex items-center justify-between px-5 pb-2">
                  <h3 className="text-sm font-bold text-gray-900">Balance</h3>
                  <p className="text-sm font-semibold text-gray-600">{formatUsd(totalUsd)}</p>
                </div>

                {/* Token List */}
                <div className="max-h-[280px] overflow-y-auto px-3 pb-3" data-testid="token-list">
                  {isLoading && (
                    <div className="flex items-center justify-center gap-2 py-8 text-gray-400">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Loading balances...</span>
                    </div>
                  )}

                  {!isLoading && error && (
                    <div className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-3 text-red-600">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span className="text-xs">{error}</span>
                    </div>
                  )}

                  {!isLoading && !error && tokens.length === 0 && (
                    <div className="py-8 text-center text-sm text-gray-400">
                      No token balances found
                    </div>
                  )}

                  {!isLoading && !error && tokens.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {tokens.map((token, i) => (
                        <TokenRow
                          key={`${token.asset_code}-${token.asset_issuer}-${i}`}
                          token={token}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer Actions */}
                <div className="flex items-center justify-between gap-3 border-t border-gray-100 bg-gray-50/50 px-5 py-4">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
