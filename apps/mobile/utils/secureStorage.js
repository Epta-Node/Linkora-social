const SecureStore = require("expo-secure-store");

// #1554 — kept in sync with secureStorage.ts. The bearer token is deliberately
// absent: the keychain reader is reachable from the mini-app bridge, and a
// `profile.read` mini app holding the app's auth token can act as the user
// against the indexer. Secrets have no key here and no entry in the generic
// facade's allowlist below.
const StorageKey = {
  WalletAddress: "wallet_address",
  ConnectionState: "connection_state",
  NetworkSettings: "network_settings",
  InstalledMiniApps: "mini_apps_installed",
};

const GENERIC_STORAGE_KEYS = new Set([StorageKey.NetworkSettings, StorageKey.InstalledMiniApps]);

function assertGenericKey(key) {
  if (!GENERIC_STORAGE_KEYS.has(key)) {
    throw new Error(`Refusing to access non-allowlisted secure storage key "${key}"`);
  }
}

async function setItem(key, value) {
  const payload = JSON.stringify(value);
  return SecureStore.setItemAsync(key, payload, {
    keychainAccessible: SecureStore.ALWAYS_THIS_DEVICE_ONLY,
  });
}

async function getItem(key) {
  const item = await SecureStore.getItemAsync(key);
  if (!item) return null;
  try {
    return JSON.parse(item);
  } catch (e) {
    return null;
  }
}

async function deleteItem(key) {
  return SecureStore.deleteItemAsync(key);
}

async function setWalletAddress(address) {
  return setItem(StorageKey.WalletAddress, address);
}

async function getWalletAddress() {
  return getItem(StorageKey.WalletAddress);
}

async function deleteWalletAddress() {
  return deleteItem(StorageKey.WalletAddress);
}

async function setConnectionState(state) {
  return setItem(StorageKey.ConnectionState, state);
}

/**
 * #1593 — the persisted session blob carries the adapter that created it
 * (`provider`) and the network it was established on (`network`) in addition to
 * `{ connected, address, timestamp }`. The restore path uses `provider` to pick
 * the right adapter instead of assuming WalletConnect for every session.
 *
 * @typedef {Object} ConnectionState
 * @property {boolean} connected
 * @property {string} address
 * @property {number} timestamp
 * @property {("freighter"|"walletconnect")=} provider
 * @property {string=} network
 */

/**
 * @returns {Promise<ConnectionState|null>}
 */
async function getConnectionState() {
  return getItem(StorageKey.ConnectionState);
}

async function deleteConnectionState() {
  return deleteItem(StorageKey.ConnectionState);
}

const secureStorage = {
  get: async (key) => {
    assertGenericKey(key);
    return getItem(key);
  },
  set: async (key, value) => {
    assertGenericKey(key);
    return setItem(key, value);
  },
  delete: async (key) => {
    assertGenericKey(key);
    return deleteItem(key);
  },
};

module.exports = {
  StorageKey,
  setWalletAddress,
  getWalletAddress,
  deleteWalletAddress,
  setConnectionState,
  getConnectionState,
  deleteConnectionState,
  secureStorage,
};
