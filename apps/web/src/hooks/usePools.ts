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

// ── Stellar address regexes ─────────────────────────────────────────────────
// Account public key (G + 55 base32 chars) — used for admin lists
export const STELLAR_KEY_RE = /^G[A-Z2-7]{55}$/;
// Soroban contract address (C + 55 base32 chars) — used for token fields
export const STELLAR_CONTRACT_RE = /^C[A-Z2-7]{55}$/;

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

// ── SDK contract client ────────────────────────────────────────────────────────

let sdkClient: any = null;

async function getSdkClient() {
  if (!sdkClient) {
    try {
      // Import the SDK client dynamically when needed
      const { LinkoraClient } = await import("linkora-sdk");
      sdkClient = new LinkoraClient({
        contractId:
          typeof window !== "undefined"
            ? (window as any).NEXT_PUBLIC_CONTRACT_ID ||
              "CBQHLSNMBF4HS3UX2PV72T75V2SXE7M2EZZTQ6YC5DSXIGGY4NPSAFAF"
            : process.env.NEXT_PUBLIC_CONTRACT_ID ||
              "CBQHLSNMBF4HS3UX2PV72T75V2SXE7M2EZZTQ6YC5DSXIGGY4NPSAFAF",
        rpcUrl:
          typeof window !== "undefined"
            ? (window as any).NEXT_PUBLIC_SOROBAN_RPC_URL ||
              "https://soroban-testnet.stellar.org"
            : process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ||
              "https://soroban-testnet.stellar.org",
      });
    } catch (err) {
      console.error("Failed to initialize SDK client:", err);
      return null;
    }
  }
  return sdkClient;
}

async function contractGetPool(poolId: string): Promise<PoolData | null> {
  const client = await getSdkClient();
  if (!client) {
    throw new Error("SDK client not available");
  }

  try {
    const pool = await client.getPool(poolId);
    return pool || null;
  } catch (err) {
    console.error(`Failed to fetch pool ${poolId}:`, err);
    throw new Error(`Failed to fetch pool ${poolId}`);
  }
}

async function contractGetAllPools(): Promise<PoolData[]> {
  const client = await getSdkClient();
  if (!client) {
    throw new Error("SDK client not available");
  }

  try {
    const pools = await client.getAllPools();
    return Array.isArray(pools) ? pools : [];
  } catch (err) {
    console.error("Failed to fetch pools:", err);
    throw new Error("Failed to fetch pools");
  }
}

async function contractGetTokenMeta(tokenAddress: string): Promise<TokenMeta> {
  const client = await getSdkClient();
  if (!client) {
    throw new Error("SDK client not available");
  }

  try {
    const meta = await client.getTokenMetadata(tokenAddress);
    return {
      symbol: meta.symbol || "TOKEN",
      decimals: meta.decimals || 7,
      name: meta.name || "Unknown Token",
    };
  } catch (err) {
    console.error(`Failed to fetch token metadata for ${tokenAddress}:`, err);
    return { symbol: "TOKEN", decimals: 7, name: "Unknown Token" };
  }
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useAllPools() {
  const [pools, setPools] = useState<PoolData[]>([]);
  const [state, setState] = useState<FetchState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  const fetch = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const data = await contractGetAllPools();
      setPools(data);
      setState("success");
      setIsStale(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pools");
      setState("error");
      // Mark existing data as stale but keep it visible
      if (pools.length > 0) {
        setIsStale(true);
      }
    }
  }, [pools.length]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { pools, state, error, isStale, refresh: fetch };
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
    contractGetTokenMeta(tokenAddress)
      .then(setMeta)
      .catch(() => {});
  }, [tokenAddress]);

  return meta;
}

export { contractGetPool, contractGetAllPools, contractGetTokenMeta };
