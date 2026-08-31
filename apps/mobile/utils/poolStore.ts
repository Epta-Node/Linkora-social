import { useSyncExternalStore } from "react";

export interface PoolWithdrawal {
  id: string;
  recipient: string;
  amount: string;
  approvals: string[];
  createdAt: number;
}

export interface PoolRecord {
  id: string;
  name: string;
  description: string;
  token: string;
  balance: string;
  admins: string[];
  threshold: number;
  withdrawals: PoolWithdrawal[];
}

const SAMPLE_ADMINS = [
  "GCKFBEIYTKP6RCZNVPH73XL7XFWTEOAO4MKONX7HOILHDVBMW5EVPOPZ",
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  "GDXU2G6VZLJIFRVDH5HLYCWJ2F64YQZH2TJUFDPBTZC53RIRZQJQ4LNK",
];

const POOL_FIXTURES: Record<
  string,
  Pick<PoolRecord, "name" | "description" | "token" | "balance">
> = {
  "creator-fund": {
    name: "Creator Fund",
    description: "Shared treasury for emerging creators",
    token: "XLM",
    balance: "18,240 XLM",
  },
  "music-drops": {
    name: "Music Drops",
    description: "Funding pool for independent releases",
    token: "NOVA",
    balance: "7,900 NOVA",
  },
  "design-guild": {
    name: "Design Guild",
    description: "Collective pool for visual artists",
    token: "ATLAS",
    balance: "3,450 ATLAS",
  },
};

const poolCache = new Map<string, PoolRecord>();
const listeners = new Set<() => void>();

function clonePool(pool: PoolRecord): PoolRecord {
  return {
    ...pool,
    admins: [...pool.admins],
    withdrawals: pool.withdrawals.map((withdrawal) => ({
      ...withdrawal,
      approvals: [...withdrawal.approvals],
    })),
  };
}

function createPoolRecord(id: string): PoolRecord {
  const fixture = POOL_FIXTURES[id];

  return {
    id,
    name: fixture?.name ?? id,
    description: fixture?.description ?? "Community managed pool",
    token: fixture?.token ?? "XLM",
    balance: fixture?.balance ?? "0 XLM",
    admins: [...SAMPLE_ADMINS],
    threshold: 2,
    withdrawals: [],
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

export function addPoolAdmin(poolId: string, address: string): boolean {
  const nextAddress = normalizeAddress(address);

  if (!isValidStellarAddress(nextAddress)) {
    return false;
  }

  let changed = false;

  updatePool(poolId, (pool) => {
    if (pool.admins.includes(nextAddress)) {
      return pool;
    }

    changed = true;
    return {
      ...pool,
      admins: [...pool.admins, nextAddress],
    };
  });

  return changed;
}

export function removePoolAdmin(poolId: string, address: string): boolean {
  const nextAddress = normalizeAddress(address);
  let changed = false;

  updatePool(poolId, (pool) => {
    if (!pool.admins.includes(nextAddress) || pool.admins.length <= 1) {
      return pool;
    }

    const admins = pool.admins.filter((admin) => admin !== nextAddress);
    const threshold = Math.min(pool.threshold, admins.length);
    changed = true;

    return {
      ...pool,
      admins,
      threshold: Math.max(1, threshold),
    };
  });

  return changed;
}

export function updatePoolThreshold(poolId: string, threshold: number): boolean {
  let changed = false;

  updatePool(poolId, (pool) => {
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > pool.admins.length) {
      return pool;
    }

    changed = true;
    return {
      ...pool,
      threshold,
    };
  });

  return changed;
}

export function recordPoolWithdrawal(
  poolId: string,
  withdrawal: Omit<PoolWithdrawal, "id" | "createdAt">
): PoolWithdrawal | null {
  if (!isValidStellarAddress(withdrawal.recipient)) {
    return null;
  }

  let created: PoolWithdrawal | null = null;

  updatePool(poolId, (pool) => {
    created = {
      id: `${Date.now()}-${pool.withdrawals.length + 1}`,
      createdAt: Date.now(),
      ...withdrawal,
    };

    return {
      ...pool,
      withdrawals: [created, ...pool.withdrawals],
    };
  });

  return created;
}

export function recordPoolDeposit(poolId: string, amount: string): void {
  updatePool(poolId, (pool) => ({
    ...pool,
    balance: `${amount} ${pool.token}`,
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
