import { useSyncExternalStore } from "react";

import { getIndexerBaseUrl } from "./indexerConfig";
import { getPoolCatalogEntry } from "./poolCatalog";

export interface PoolApproval {
  /** Admin who signed. Always the connected wallet — never typed in. */
  address: string;
  /** Wallet-produced signature (chain proof) for this admin's approval. */
  signature: string;
  signedAt: number;
}

export interface PoolSignerStatus {
  address: string;
  approved: boolean;
}

export interface PoolWithdrawal {
  id: string;
  recipient: string;
  amount: string;
  approvals: PoolApproval[];
  createdAt: number;
}

export type PoolStateSource = "unknown" | "chain";

export interface PoolRecord {
  id: string;
  name: string;
  description: string;
  token: string;
  balance: string;
  admins: string[];
  threshold: number;
  withdrawals: PoolWithdrawal[];
  /**
   * #1557 — where `admins` and `threshold` came from. "unknown" is the state a
   * pool starts in and the state it stays in if the indexer cannot be reached:
   * with no chain-sourced admin set there is nobody to authorise a withdrawal,
   * so every withdrawal path fails closed rather than trusting a local array.
   */
  source: PoolStateSource;
}

/**
 * #1592 — display metadata is read from the canonical catalog instead of a
 * private copy of it. The old `POOL_FIXTURES` literal here duplicated the
 * catalog (and drifted from the ids the Pools tab actually rendered), so a
 * pool could be known to one module and unknown to another.
 */
function getPoolFixture(
  poolId: string
): Pick<PoolRecord, "name" | "description" | "token" | "balance"> | undefined {
  const entry = getPoolCatalogEntry(poolId);
  if (!entry) return undefined;

  return {
    name: entry.name,
    description: entry.description,
    token: entry.token,
    balance: entry.balance,
  };
}

const poolCache = new Map<string, PoolRecord>();
const listeners = new Set<() => void>();

function clonePool(pool: PoolRecord): PoolRecord {
  return {
    ...pool,
    admins: [...pool.admins],
    withdrawals: pool.withdrawals.map((withdrawal) => ({
      ...withdrawal,
      approvals: withdrawal.approvals.map((approval) => ({ ...approval })),
    })),
  };
}

function createPoolRecord(id: string): PoolRecord {
  const fixture = getPoolFixture(id);

  // #1557 — no hard-coded admin list. The old fixture shipped three sample
  // addresses and a threshold of 2, which made a pool look governed by people
  // who have nothing to do with it. Admins and threshold arrive from the
  // indexer/chain via `syncPoolFromChain`; until then the pool is ungoverned
  // and every guarded action refuses.
  return {
    id,
    name: fixture?.name ?? id,
    description: fixture?.description ?? "Community managed pool",
    token: fixture?.token ?? "XLM",
    balance: fixture?.balance ?? "0 XLM",
    admins: [],
    threshold: 0,
    withdrawals: [],
    source: "unknown",
  };
}

function ensurePool(poolId: string): PoolRecord {
  if (!poolCache.has(poolId)) {
    poolCache.set(poolId, createPoolRecord(poolId));
  }

  return poolCache.get(poolId) as PoolRecord;
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

function updatePool(poolId: string, updater: (pool: PoolRecord) => PoolRecord): void {
  const current = ensurePool(poolId);
  poolCache.set(poolId, updater(clonePool(current)));
  emit();
}

export function subscribePoolState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPoolRecord(poolId: string): PoolRecord {
  return ensurePool(poolId);
}

export function usePoolRecord(poolId: string): PoolRecord {
  return useSyncExternalStore(
    subscribePoolState,
    () => getPoolRecord(poolId),
    () => getPoolRecord(poolId)
  );
}

export function isValidStellarAddress(address: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(address.trim());
}

export function normalizeAddress(address: string): string {
  return address.trim().toUpperCase();
}

export interface PoolChainSnapshot {
  admins: string[];
  threshold: number;
  balance?: string;
  token?: string;
}

/**
 * #1557 — applies admin/threshold/balance read from the indexer (which mirrors
 * contract state). A snapshot with no admins or a non-positive threshold is
 * rejected: applying it would either wipe governance or, worse, leave a
 * threshold of 0 that `0 >= 0` approvals satisfy.
 */
export function syncPoolFromChain(poolId: string, snapshot: PoolChainSnapshot): boolean {
  const admins = Array.from(
    new Set(snapshot.admins.map(normalizeAddress).filter(isValidStellarAddress))
  );
  const threshold = Math.floor(snapshot.threshold);

  if (
    admins.length === 0 ||
    !Number.isFinite(threshold) ||
    threshold < 1 ||
    threshold > admins.length
  ) {
    return false;
  }

  updatePool(poolId, (pool) => ({
    ...pool,
    admins,
    threshold,
    ...(snapshot.balance !== undefined ? { balance: snapshot.balance } : {}),
    ...(snapshot.token !== undefined ? { token: snapshot.token } : {}),
    source: "chain",
  }));

  return true;
}

/**
 * #1557 — reads the pool's admin set and threshold from the indexer, which
 * mirrors contract state. A failure to reach it leaves the record in the
 * "unknown" state, which every guarded action treats as "no governance" rather
 * than falling back to a locally-known admin list.
 */
export async function refreshPoolFromIndexer(poolId: string): Promise<boolean> {
  const indexerUrl = getIndexerBaseUrl();
  const response = await fetch(`${indexerUrl}/api/pools/${encodeURIComponent(poolId)}`);

  if (!response.ok) {
    throw new Error(`Failed to load pool state (${response.status})`);
  }

  const data = (await response.json()) as {
    admins?: unknown;
    threshold?: unknown;
    balance?: unknown;
    token?: unknown;
  };

  return syncPoolFromChain(poolId, {
    admins: Array.isArray(data.admins) ? data.admins.map(String) : [],
    threshold: Number(data.threshold),
    ...(typeof data.balance === "string" ? { balance: data.balance } : {}),
    ...(typeof data.token === "string" ? { token: data.token } : {}),
  });
}

/** True when the pool record carries a chain-sourced admin set and threshold. */
export function isPoolGovernanceLoaded(pool: PoolRecord): boolean {
  return pool.source === "chain" && pool.threshold >= 1 && pool.admins.length > 0;
}

export type ApprovalVerdict = { valid: true } | { valid: false; reason: string };

/**
 * #1557 — the client-side half of the multisig check. The contract is the real
 * authority; this mirrors it so a withdrawal that the chain would reject is
 * never presented as executable, and so a malformed approval set cannot even
 * reach submission. Every requirement fails closed:
 *
 *  - the admin set and threshold must come from the chain, not local state;
 *  - each approval must carry a wallet-produced signature;
 *  - each approval must be from a current admin, from a distinct address;
 *  - the set must meet the threshold.
 */
export function verifyPoolApprovals(pool: PoolRecord, approvals: PoolApproval[]): ApprovalVerdict {
  if (pool.source !== "chain") {
    return { valid: false, reason: "Pool admin set has not been loaded from the chain." };
  }

  if (pool.threshold < 1) {
    return { valid: false, reason: "Pool has no valid signature threshold." };
  }

  const seen = new Set<string>();

  for (const approval of approvals) {
    const signer = normalizeAddress(approval.address);

    if (!isValidStellarAddress(signer) || !pool.admins.includes(signer)) {
      return { valid: false, reason: `${approval.address} is not a pool admin.` };
    }

    if (seen.has(signer)) {
      return { valid: false, reason: `${signer} approved more than once.` };
    }

    if (typeof approval.signature !== "string" || approval.signature.length === 0) {
      return { valid: false, reason: `${signer} did not sign this withdrawal.` };
    }

    seen.add(signer);
  }

  if (approvals.length < pool.threshold) {
    return {
      valid: false,
      reason: `Needs ${pool.threshold} admin signatures, has ${approvals.length}.`,
    };
  }

  return { valid: true };
}

export function recordPoolWithdrawal(
  poolId: string,
  withdrawal: Omit<PoolWithdrawal, "id" | "createdAt">
): PoolWithdrawal | null {
  if (!isValidStellarAddress(withdrawal.recipient)) {
    return null;
  }

  const pool = getPoolRecord(poolId);
  const verdict = verifyPoolApprovals(pool, withdrawal.approvals);

  if (!verdict.valid) {
    return null;
  }

  let created: PoolWithdrawal | null = null;

  updatePool(poolId, (current) => {
    created = {
      id: `${Date.now()}-${current.withdrawals.length + 1}`,
      createdAt: Date.now(),
      ...withdrawal,
      approvals: withdrawal.approvals.map((approval) => ({
        ...approval,
        address: normalizeAddress(approval.address),
      })),
    };

    return {
      ...current,
      withdrawals: [created, ...current.withdrawals],
    };
  });

  return created;
}

/** Extracts the leading numeric amount from a formatted balance string like "18,240 XLM". */
function parseBalanceAmount(balance: string): number {
  const match = balance.match(/-?[\d,]+(\.\d+)?/);
  if (!match) return 0;
  const parsed = parseFloat(match[0].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatBalanceAmount(amount: number, token: string): string {
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: 7 })} ${token}`;
}

export function recordPoolDeposit(poolId: string, amount: string): void {
  const delta = parseFloat(amount);
  if (!Number.isFinite(delta)) return;

  updatePool(poolId, (pool) => ({
    ...pool,
    balance: formatBalanceAmount(parseBalanceAmount(pool.balance) + delta, pool.token),
  }));
}

export function setPoolBalance(poolId: string, balance: string): void {
  updatePool(poolId, (pool) => ({
    ...pool,
    balance,
  }));
}

export function resetPoolState(poolId?: string): void {
  if (poolId) {
    poolCache.delete(poolId);
  } else {
    poolCache.clear();
  }

  emit();
}
