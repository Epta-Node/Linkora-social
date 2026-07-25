"use client";

import { useEffect, useState, useCallback, useRef } from "react";

const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
const CACHE_TTL_MS = 30_000;

export interface TokenBalance {
  asset_type: string;
  asset_code: string;
  asset_issuer: string;
  balance: string;
  limit?: string;
}

export interface TokenWithPrice extends TokenBalance {
  usdPrice: number | null;
  usdValue: number | null;
}

const NATIVE_LOGO = "https://assets.stellar.org/sdp/native.svg";

const ISSUER_LOGOS: Record<string, string> = {
  GDCISQG4K77K4E45ON22JBAQY2SE7LITL6Y7RWU6QCN5IJNXCEJGV677:
    "https://assets.stellar.org/sdp/usdc.svg",
};

function getAssetLogo(code: string, issuer: string): string {
  if (code === "XLM") return NATIVE_LOGO;
  if (ISSUER_LOGOS[issuer]) return ISSUER_LOGOS[issuer];
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(code)}&background=6366f1&color=fff&size=32&bold=true`;
}

interface CacheEntry {
  data: TokenWithPrice[];
  timestamp: number;
}

export const balanceCache = new Map<string, CacheEntry>();

export function clearBalanceCache() {
  balanceCache.clear();
}

export function useTokenBalances(address: string | null) {
  const [tokens, setTokens] = useState<TokenWithPrice[]>([]);
  const [totalUsd, setTotalUsd] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchBalances = useCallback(async () => {
    if (!address) return;

    const cached = balanceCache.get(address);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      setTokens(cached.data);
      setTotalUsd(cached.data.reduce((sum, t) => sum + (t.usdValue ?? 0), 0));
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`${HORIZON_TESTNET}/accounts/${address}`, {
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Horizon returned ${res.status}`);
      }

      const data = await res.json();
      const balances: TokenBalance[] = data.balances ?? [];

      const nativeXlm = balances.find((b) => b.asset_type === "native");
      const nonNative = balances.filter((b) => b.asset_type !== "native");
      const tokenList: TokenBalance[] = [
        ...(nativeXlm ? [{ ...nativeXlm, asset_code: "XLM", asset_issuer: "" }] : []),
        ...nonNative,
      ];

      const xlmPrice = await fetchXlmPrice();

      const tokensWithPrice: TokenWithPrice[] = tokenList.map((t) => {
        const amount = parseFloat(t.balance) || 0;
        const usdPrice = t.asset_code === "XLM" ? xlmPrice : null;
        const usdValue = usdPrice !== null ? amount * usdPrice : null;

        return {
          ...t,
          usdPrice,
          usdValue,
          logo: getAssetLogo(t.asset_code, t.asset_issuer),
        } as TokenWithPrice & { logo: string };
      });

      const total = tokensWithPrice.reduce((sum, t) => sum + (t.usdValue ?? 0), 0);

      balanceCache.set(address, { data: tokensWithPrice, timestamp: Date.now() });

      if (!controller.signal.aborted) {
        setTokens(tokensWithPrice);
        setTotalUsd(total);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Failed to fetch balances";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchBalances();
    return () => abortRef.current?.abort();
  }, [fetchBalances]);

  return { tokens, totalUsd, isLoading, error, refresh: fetchBalances };
}

async function fetchXlmPrice(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd"
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.stellar?.usd ?? null;
  } catch {
    return null;
  }
}

export { getAssetLogo };
