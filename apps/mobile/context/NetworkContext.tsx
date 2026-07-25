import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  deleteNetworkSettings,
  getNetworkSettings,
  setNetworkSettings,
} from "../utils/secureStorage";

export type StellarNetworkId = "TESTNET" | "MAINNET";

export interface NetworkPreset {
  id: StellarNetworkId;
  label: string;
  chain: string;
  rpcUrl: string;
  contractId: string;
  mainnetWarning?: string;
}

export interface NetworkSettings {
  selectedNetwork: StellarNetworkId;
  rpcUrl: string;
}

const NETWORK_PRESETS: Record<StellarNetworkId, NetworkPreset> = {
  TESTNET: {
    id: "TESTNET",
    label: "Testnet",
    chain: "stellar:testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    contractId: "CBLNKTESTNET0000000000000000000000000000000000000000000000",
  },
  MAINNET: {
    id: "MAINNET",
    label: "Mainnet",
    chain: "stellar:mainnet",
    rpcUrl: "https://mainnet.sorobanrpc.com",
    contractId: "CBLNKMAINNET0000000000000000000000000000000000000000000000",
    mainnetWarning: "Mainnet is live. Any transaction affects real assets.",
  },
};

const DEFAULT_SETTINGS: NetworkSettings = {
  selectedNetwork: "TESTNET",
  rpcUrl: NETWORK_PRESETS.TESTNET.rpcUrl,
};

export interface NetworkContextType {
  settings: NetworkSettings;
  network: NetworkPreset;
  contractId: string;
  rpcUrl: string;
  isMainnet: boolean;
  warning: string | null;
  ready: boolean;
  setSelectedNetwork: (network: StellarNetworkId) => Promise<void>;
  setRpcUrl: (rpcUrl: string) => Promise<void>;
  resetRpcUrl: () => Promise<void>;
  resetSettings: () => Promise<void>;
}

const NetworkContext = createContext<NetworkContextType | null>(null);

function normalizeRpcUrl(rpcUrl: string): string {
  return rpcUrl.trim();
}

export function NetworkProvider({ children }: { children: ReactNode }): JSX.Element {
  const [settings, setSettingsState] = useState<NetworkSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        const saved = await getNetworkSettings<NetworkSettings>();

        if (cancelled) {
          return;
        }

        if (saved?.selectedNetwork && NETWORK_PRESETS[saved.selectedNetwork]) {
          setSettingsState({
            selectedNetwork: saved.selectedNetwork,
            rpcUrl:
              normalizeRpcUrl(saved.rpcUrl) || NETWORK_PRESETS[saved.selectedNetwork].rpcUrl,
          });
        }
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    }

    loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (nextSettings: NetworkSettings) => {
    setSettingsState(nextSettings);
    await setNetworkSettings(nextSettings);
  }, []);

  const setSelectedNetwork = useCallback(
    async (network: StellarNetworkId) => {
      const preset = NETWORK_PRESETS[network];
      await persist({
        selectedNetwork: network,
        rpcUrl: preset.rpcUrl,
      });
    },
    [persist]
  );

  const setRpcUrl = useCallback(
    async (rpcUrl: string) => {
      const next = normalizeRpcUrl(rpcUrl) || NETWORK_PRESETS[settings.selectedNetwork].rpcUrl;
      await persist({
        ...settings,
        rpcUrl: next,
      });
    },
    [persist, settings]
  );

  const resetRpcUrl = useCallback(async () => {
    await persist({
      ...settings,
      rpcUrl: NETWORK_PRESETS[settings.selectedNetwork].rpcUrl,
    });
  }, [persist, settings]);

  const resetSettings = useCallback(async () => {
    await deleteNetworkSettings();
    setSettingsState(DEFAULT_SETTINGS);
  }, []);

  const network = NETWORK_PRESETS[settings.selectedNetwork];
  const warning = network.mainnetWarning ?? null;

  const value = useMemo<NetworkContextType>(
    () => ({
      settings,
      network,
      contractId: network.contractId,
      rpcUrl: settings.rpcUrl,
      isMainnet: network.id === "MAINNET",
      warning,
      ready,
      setSelectedNetwork,
      setRpcUrl,
      resetRpcUrl,
      resetSettings,
    }),
    [
      network,
      ready,
      resetRpcUrl,
      resetSettings,
      setRpcUrl,
      setSelectedNetwork,
      settings,
      warning,
    ]
  );

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetworkContext(): NetworkContextType {
  const ctx = useContext(NetworkContext);
  if (!ctx) {
    throw new Error("useNetworkContext must be used within a NetworkProvider");
  }
  return ctx;
}

export { NETWORK_PRESETS, DEFAULT_SETTINGS };
