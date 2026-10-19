import * as SecureStore from "expo-secure-store";

// #1554 — the bearer token is deliberately absent from this table. The
// key/value primitives below are reachable from the mini-app bridge, and a
// `profile.read` mini app holding the app's auth token can call the indexer as
// the user: read anything, write anything, and make the permission model
// meaningless. The bridge only ever hands back public, non-sensitive fields.
// If a mini app ever needs API access it must be a short-lived token scoped to
// that mini app and its declared permission set, minted by a dedicated host
// endpoint — never this module's keychain.
const StorageKey = {
  WalletAddress: "wallet_address",
  ConnectionState: "connection_state",
  NetworkSettings: "network_settings",
  InstalledMiniApps: "mini_apps_installed",
  MasterKey: "secure_master_key_v2",
  SecretIndex: "secure_secret_index_v2",
  LastBackupReminder: "secure_last_backup_reminder_v2",
} as const;

/**
 * #1554 — keys the generic `secureStorage` facade may touch. The facade exists
 * for call sites that store a non-secret blob under a key of their own (the
 * installed-mini-app list, network settings); a closed allowlist means adding a
 * secret later cannot make it readable by default. Secrets have no entry here
 * and must use a dedicated, narrowly scoped accessor.
 */
const GENERIC_STORAGE_KEYS: ReadonlySet<string> = new Set<string>([
  StorageKey.NetworkSettings,
  StorageKey.InstalledMiniApps,
]);

function assertGenericKey(key: string): void {
  if (!GENERIC_STORAGE_KEYS.has(key)) {
    throw new Error(`Refusing to access non-allowlisted secure storage key "${key}"`);
  }
}

export type StoredWalletProvider = "freighter" | "walletconnect";

export interface ConnectionState {
  connected: boolean;
  address: string;
  timestamp: number;
  /**
   * #1593 — the adapter the session was established with. Without this the
   * restore path had to assume WalletConnect, so a Freighter session was
   * written on connect and deleted on the next cold start.
   *
   * Optional only for sessions persisted before this field existed; the
   * restore path migrates those by probing the providers.
   */
  provider?: StoredWalletProvider;
  /** #1593 — the network the session was established on. */
  network?: string;
}

async function setItem(key: string, value: unknown): Promise<void> {
  const payload = JSON.stringify(value);
  await SecureStore.setItemAsync(key, payload, {
    keychainAccessible:
      SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY ?? SecureStore.ALWAYS_THIS_DEVICE_ONLY,
  });
}

const secureOptions = {
  keychainAccessible:
    SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY ?? SecureStore.ALWAYS_THIS_DEVICE_ONLY,
  requireAuthentication: true,
};

function randomKey(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(32);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now()}-${Math.random()}-${Math.random()}`;
}

async function masterKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(StorageKey.MasterKey, secureOptions);
  if (existing) return existing;
  const created = randomKey();
  await SecureStore.setItemAsync(StorageKey.MasterKey, created, secureOptions);
  return created;
}

// HKDF-style service separation. The master key never leaves SecureStore and
// every service receives a distinct context-bound key.
async function deriveServiceKey(service: string): Promise<string> {
  const master = await masterKey();
  const data = new TextEncoder().encode(`${service}:linkora-hkdf:${master}`);
  const digest = await globalThis.crypto?.subtle?.digest("SHA-256", data);
  return digest ? Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") : `${service}:${master}`;
}

export async function setSecret(service: string, value: unknown): Promise<void> {
  const key = `secret:${service}:${await deriveServiceKey(service)}`;
  const index = (await getItem<string[]>(StorageKey.SecretIndex)) ?? [];
  if (!index.includes(service)) await setItem(StorageKey.SecretIndex, [...index, service]);
  await SecureStore.setItemAsync(key, JSON.stringify(value), secureOptions);
}

export async function getSecret<T>(service: string): Promise<T | null> {
  const key = `secret:${service}:${await deriveServiceKey(service)}`;
  const item = await SecureStore.getItemAsync(key, secureOptions);
  if (!item) return null;
  try { return JSON.parse(item) as T; } catch { return null; }
}

export async function rotateKeys(): Promise<void> {
  const oldMaster = await masterKey();
  const services = (await getItem<string[]>(StorageKey.SecretIndex)) ?? [];
  const values = await Promise.all(services.map(async (service) => [service, await getSecret(service)] as const));
  await SecureStore.deleteItemAsync(StorageKey.MasterKey);
  await masterKey();
  for (const [service, value] of values) {
    if (value !== null) await setSecret(service, value);
  }
  void oldMaster;
}

export async function shouldShowBackupReminder(): Promise<boolean> {
  const last = await getItem<number>(StorageKey.LastBackupReminder);
  return !last || Date.now() - last >= 7 * 24 * 60 * 60 * 1000;
}

export async function markBackupComplete(): Promise<void> {
  await setItem(StorageKey.LastBackupReminder, Date.now());
}

async function getItem<T>(key: string): Promise<T | null> {
  const item = await SecureStore.getItemAsync(key);
  if (!item) return null;
  try {
    return JSON.parse(item) as T;
  } catch {
    return null;
  }
}

async function deleteItem(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}

export async function setWalletAddress(address: string): Promise<void> {
  return setItem(StorageKey.WalletAddress, address);
}

export async function getWalletAddress(): Promise<string | null> {
  return getItem<string>(StorageKey.WalletAddress);
}

export async function deleteWalletAddress(): Promise<void> {
  return deleteItem(StorageKey.WalletAddress);
}

export async function setConnectionState(state: ConnectionState): Promise<void> {
  return setItem(StorageKey.ConnectionState, state);
}

export async function getConnectionState(): Promise<ConnectionState | null> {
  return getItem<ConnectionState>(StorageKey.ConnectionState);
}

export async function deleteConnectionState(): Promise<void> {
  return deleteItem(StorageKey.ConnectionState);
}

export async function setNetworkSettings(settings: unknown): Promise<void> {
  return setItem(StorageKey.NetworkSettings, settings);
}

export async function getNetworkSettings<T>(): Promise<T | null> {
  return getItem<T>(StorageKey.NetworkSettings);
}

export async function deleteNetworkSettings(): Promise<void> {
  return deleteItem(StorageKey.NetworkSettings);
}

export { StorageKey };

/**
 * Generic, non-secret blob storage. Restricted to GENERIC_STORAGE_KEYS so it
 * can never be used as a back door to the keychain (#1554).
 */
export const secureStorage = {
  get: async <T>(key: string): Promise<T | null> => {
    assertGenericKey(key);
    return getItem<T>(key);
  },
  set: async (key: string, value: unknown): Promise<void> => {
    assertGenericKey(key);
    return setItem(key, value);
  },
  delete: async (key: string): Promise<void> => {
    assertGenericKey(key);
    return deleteItem(key);
  },
};
