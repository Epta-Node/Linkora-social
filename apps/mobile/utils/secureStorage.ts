import * as SecureStore from "expo-secure-store";

const StorageKey = {
  WalletAddress: "wallet_address",
  ConnectionState: "connection_state",
  AuthToken: "auth_token",
  NetworkSettings: "network_settings",
};

export interface ConnectionState {
  connected: boolean;
  address: string;
  timestamp: number;
}

async function setItem(key: string, value: unknown): Promise<void> {
  const payload = JSON.stringify(value);
  await SecureStore.setItemAsync(key, payload, {
    keychainAccessible: SecureStore.ALWAYS_THIS_DEVICE_ONLY,
  });
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

export { StorageKey, setItem, getItem, deleteItem };

export const secureStorage = {
  get: getItem,
  set: setItem,
  delete: deleteItem,
};
