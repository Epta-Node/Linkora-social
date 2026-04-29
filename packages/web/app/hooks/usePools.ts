"use client";

import { useState, useCallback, useEffect, useRef } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PoolData {
  pool_id: string;
  token: string;
  balance: bigint;
  admins: string[];
  threshold: number;
}

export interface TokenMeta {
  symbol: string;
  decimals: number;
  name: string;
}

export type FetchState = "idle" | "loading" | "success" | "error";

// ── Stellar public key regex (G + 55 base32 chars) ───────────────────────────
export const STELLAR_KEY_RE = /^G[A-Z2-7]{55}$/;

// ── Formatting helpers ────────────────────────────────────────────────────────

export function truncateAddress(addr: string, head = 6, tail = 4): string {
  if (addr.length <= head + tail) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function formatTokenAmount(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const divisor = BigInt(10 ** decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr.length > 0 ? `${whole}.${fracStr}` : whole.toString();
}

export function parseTokenAmount(value: string, decimals: number): bigint {
  const [whole, frac = ""] = value.split(".");
  const fracPadded = frac.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole || "0") * BigInt(10 ** decimals) + BigInt(fracPadded || "0");
}

// ── Mock contract client ──────────────────────────────────────────────────────
// Replace the body of each function with real SDK calls once the generated
// client is wired up (packages/sdk/src/index.ts → stellar contract bindings).

async function contractGetPool(poolId: string): Promise<PoolData | null> {
  // TODO: replace with: await client.get_pool({ pool_id: poolId })
  await new Promise((r) => setTimeout(r, 600));

  const mockPools: Record<string, PoolData> = {
    community: {
      pool_id: "community",
      token: "GDQOE23CFSUMSVQK4Y5JHPPYK73VYCNHZHA7ENKCV37P6SUEO6XQBKPP",
      balance: BigInt("5000000000"),
      admins: [
        "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
        "GBVVJJWAKJHTEQHZGM5AOKXJLNBGKDSMXZXJZXJZXJZXJZXJZXJZXJ",
        "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZXG5CHCGZXG5CHCGZXG5",
        "GDFOHLMYCXVZD2CDXZLMIRQZPEAXE7B5MURMIZ4IYQUENHZSJPINMQB",
        "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODB4",
      ],
      threshold: 3,
    },
    grants: {
      pool_id: "grants",
      token: "GDQOE23CFSUMSVQK4Y5JHPPYK73VYCNHZHA7ENKCV37P6SUEO6XQBKPP",
      balance: BigInt("0"),
      admins: [
        "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
        "GBVVJJWAKJHTEQHZGM5AOKXJLNBGKDSMXZXJZXJZXJZXJZXJZXJZXJ",
      ],
      threshold: 2,
    },
    devfund: {
      pool_id: "devfund",
      token: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZXG5CHCGZXG5CHCGZXG5",
      balance: BigInt("12500000000"),
      admins: [
        "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
        "GBVVJJWAKJHTEQHZGM5AOKXJLNBGKDSMXZXJZXJZXJZXJZXJZXJZXJ",
        "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZXG5CHCGZXG5CHCGZXG5",
      ],
      threshold: 2,
    },
  };

  return mockPools[poolId] ?? null;
}

async function contractGetAllPools(): Promise<PoolData[]> {
  // TODO: replace with indexed query or event scan
  await new Promise((r) => setTimeout(r, 800));
  const ids = ["community", "grants", "devfund"];
  const results = await Promise.all(ids.map(contractGetPool));
  return results.filter(Boolean) as PoolData[];
}

async function contractGetTokenMeta(tokenAddress: string): Promise<TokenMeta> {
  // TODO: replace with SEP-41 token.symbol() / token.decimals() calls
  await new Promise((r) => setTimeout(r, 200));
  const mocks: Record<string, TokenMeta> = {
    GDQOE23CFSUMSVQK4Y5JHPPYK73VYCNHZHA7ENKCV37P6SUEO6XQBKPP: {
      symbol: "USDC",
      decimals: 7,
      name: "USD Coin",
    },
    GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZXG5CHCGZXG5CHCGZXG5: {
      symbol: "XLM",
      decimals: 7,
      name: "Stellar Lumens",
    },
  };
  return (
    mocks[tokenAddress] ?? { symbol: "TOKEN", decimals: 7, name: "Unknown Token" }
  );
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useAllPools() {
  const [pools, setPools] = useState<PoolData[]>([]);
  const [state, setState] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const data = await contractGetAllPools();
      setPools(data);
      setState("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pools");
      setState("error");
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { pools, state, error, refresh: fetch };
}

export function usePool(poolId: string | null) {
  const [pool, setPool] = useState<PoolData | null>(null);
  const [state, setState] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);
  const prevId = useRef<string | null>(null);

  const fetch = useCallback(async (id: string) => {
    setState("loading");
    setError(null);
    try {
      const data = await contractGetPool(id);
      setPool(data);
      setState("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pool not found");
      setState("error");
    }
  }, []);

  useEffect(() => {
    if (!poolId || poolId === prevId.current) return;
    prevId.current = poolId;
    fetch(poolId);
  }, [poolId, fetch]);

  return { pool, state, error, refresh: () => poolId && fetch(poolId) };
}

export function useTokenMeta(tokenAddress: string | null) {
  const [meta, setMeta] = useState<TokenMeta | null>(null);

  useEffect(() => {
    if (!tokenAddress) return;
    contractGetTokenMeta(tokenAddress).then(setMeta).catch(() => {});
  }, [tokenAddress]);

  return meta;
}

export { contractGetPool, contractGetAllPools, contractGetTokenMeta };
