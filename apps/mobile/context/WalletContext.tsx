import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { Linking } from "react-native";
import {
  setWalletAddress,
  getWalletAddress,
  deleteWalletAddress,
  setConnectionState,
  getConnectionState,
  deleteConnectionState,
} from "../utils/secureStorage";
import { useNetworkContext, type NetworkPreset, type StellarNetworkId } from "./NetworkContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WalletState = "loading" | "disconnected" | "connecting" | "connected" | "error";

export type WalletProviderKind = "freighter" | "walletconnect";

export type WalletNetwork = StellarNetworkId;

export interface WalletInfo {
  address: string | null;
  network: WalletNetwork | null;
  provider: WalletProviderKind | null;
}

interface StoredConnectionState {
  connected: boolean;
  address: string;
  timestamp: number;
}

interface WalletConnectLike {
  connect: (network: NetworkPreset) => Promise<{ publicKey?: string; address?: string }>;
  disconnect: () => Promise<void>;
  getPublicKey?: () => Promise<string>;
  isConnected?: () => Promise<boolean>;
  signTransaction?: (payload: { txXdr: string }) => Promise<WalletSignResult>;
  signAndSubmitTransaction?: (payload: {
    txXdr: string;
    rpcUrl?: string;
  }) => Promise<WalletSubmitResult>;
}

interface WalletSignResult {
  signedTxXdr?: string;
  signedXdr?: string;
  signed?: string;
}

interface WalletSubmitResult {
  hash?: string;
  txHash?: string;
}

interface StellarServerWithSubmit {
  submitTransaction: (signedXdr: string) => Promise<WalletSubmitResult>;
}

type WalletConnectRequestArgs = {
  topic: string;
  chainId: string;
  chain: string;
  request: {
    method: string;
    params: { txXdr: string };
  };
};

type LinkoraGlobal = typeof globalThis & {
  __LINKORA_WALLET_KIT__?: WalletConnectLike;
};

async function createWalletConnectAdapter(): Promise<WalletConnectLike> {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const projectId = env?.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID;

  const { default: SignClient } = await import("@walletconnect/sign-client");
  let client: Awaited<ReturnType<typeof SignClient.init>> | null = null;
  let topic: string | null = null;
  let currentAddress: string | null = null;
  let connectedNetwork: NetworkPreset | null = null;

  const adapter: WalletConnectLike = {
    async connect(network: NetworkPreset) {
      if (!projectId) {
        throw new Error("WalletConnect project id not configured");
      }

      client =
        client ??
        (await SignClient.init({
          projectId,
          metadata: {
            name: "Linkora",
            description: "Linkora SocialFi mobile app",
            url: "https://github.com/Epta-Node/Linkora-social",
            icons: [],
          },
        }));

      const { uri, approval } = await client.connect({
        requiredNamespaces: {
          stellar: {
            methods: ["stellar_signXDR"],
            chains: [network.chain],
            events: ["accountsChanged"],
          },
        },
      });

      if (uri) await Linking.openURL(uri);

      const session = await approval();
      topic = session.topic;
      const account = session.namespaces.stellar?.accounts?.[0];
      currentAddress = account?.split(":").pop() ?? null;
      connectedNetwork = network;

      if (!currentAddress) throw new Error("No Stellar account returned from WalletConnect");

      return { publicKey: currentAddress };
    },

    async disconnect() {
      if (client && topic) {
        await client.disconnect({ topic, reason: { code: 6000, message: "User disconnected" } });
      }
      topic = null;
      currentAddress = null;
      connectedNetwork = null;
    },

    async getPublicKey() {
      if (!currentAddress) throw new Error("WalletConnect is not connected");
      return currentAddress;
    },

    async isConnected() {
      return Boolean(currentAddress);
    },

    async signTransaction({ txXdr }: { txXdr: string }) {
      if (!client || !topic || !connectedNetwork) throw new Error("Wallet not connected");

      const request = {
        topic,
        chainId: connectedNetwork.chain,
        chain: connectedNetwork.chain,
        request: {
          method: "stellar_signXDR",
          params: { txXdr },
        },
      } satisfies WalletConnectRequestArgs;

      const res = await client.request(request as Parameters<typeof client.request>[0]);
      return res as WalletSignResult;
    },

    async signAndSubmitTransaction({ txXdr, rpcUrl }: { txXdr: string; rpcUrl?: string }) {
      const signed = await adapter.signTransaction?.({ txXdr });
      const signedXdr = signed?.signedTxXdr || signed?.signedXdr || signed?.signed;
      if (!signedXdr) throw new Error("Wallet did not return signed transaction XDR");

      const { rpc } = await import("@stellar/stellar-sdk");
      const server = new rpc.Server(rpcUrl ?? connectedNetwork?.rpcUrl ?? "");
      const submitRes = await (server as unknown as StellarServerWithSubmit).submitTransaction(
        signedXdr
      );
      return submitRes;
    },
  };

  return adapter;
}

declare global {
  // eslint-disable-next-line no-var
  var __LINKORA_WALLET_KIT__: WalletConnectLike | undefined;
}

export interface WalletContextType {
  state: WalletState;
  wallet: WalletInfo;
  network: WalletNetwork;
  error: string | null;
  connect: (provider?: WalletProviderKind) => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
  setNetwork: (network: WalletNetwork) => void;
}

const WalletContext = createContext<WalletContextType | null>(null);

export function WalletProvider({ children }: { children: ReactNode }): JSX.Element {
  const { network: selectedNetwork } = useNetworkContext();
  const [state, setState] = useState<WalletState>("loading");
  const [network, setNetwork] = useState<WalletNetwork>("TESTNET");
  const [wallet, setWallet] = useState<WalletInfo>({
    address: null,
    network: null,
    provider: null,
  });
  const [error, setError] = useState<string | null>(null);

  const [walletKit, setWalletKit] = useState<WalletConnectLike | null>(
    () => globalThis.__LINKORA_WALLET_KIT__ ?? null
  );

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        if (globalThis.__LINKORA_WALLET_KIT__) {
          setWalletKit(globalThis.__LINKORA_WALLET_KIT__);
          return;
        }

        if (!cancelled) {
          const adapter = await createWalletConnectAdapter();
          // Expose globally for other modules that expect a wallet kit
          // (tests or mini-app bridges may rely on this global).
          (globalThis as LinkoraGlobal).__LINKORA_WALLET_KIT__ = adapter;
          setWalletKit(adapter);
        }
      } catch {
        if (!cancelled) {
          setState("error");
          setError("Wallet kit not available");
        }
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  const importFreighterApi = useCallback(async () => {
    const loader = new Function("specifier", "return import(specifier)") as (
      specifier: string
    ) => Promise<Record<string, unknown>>;
    return loader("@stellar/freighter-api");
  }, []);

  const requestFreighterAddress = useCallback(async (): Promise<string> => {
    const freighter = await importFreighterApi();

    const available =
      typeof freighter.isConnected === "function" ? await freighter.isConnected() : true;

    if (!available) throw new Error("Freighter is not available");

    if (typeof freighter.requestAccess === "function") {
      const result = await freighter.requestAccess();
      if (typeof result === "string") return result;
      if (
        result &&
        typeof result === "object" &&
        "address" in result &&
        typeof result.address === "string"
      ) {
        return result.address;
      }
    }

    if (typeof freighter.getPublicKey === "function") {
      const publicKey = await freighter.getPublicKey();
      if (typeof publicKey === "string") return publicKey;
    }

    if (typeof freighter.getAddress === "function") {
      const result = await freighter.getAddress();
      if (typeof result === "string") return result;
      if (
        result &&
        typeof result === "object" &&
        "address" in result &&
        typeof result.address === "string"
      ) {
        return result.address;
      }
    }

    throw new Error("No address returned from Freighter");
  }, [importFreighterApi]);

  const checkConnectionState = useCallback(async () => {
    if (!walletKit) return;

    try {
      setState("loading");
      setError(null);

      const storedAddress = await getWalletAddress();
      const storedConn = await getConnectionState();

      if (storedAddress && storedConn) {
        const isConnected: boolean = walletKit.isConnected
          ? await walletKit.isConnected()
          : Boolean(storedAddress);

        if (isConnected) {
          const currentAddress: string = walletKit.getPublicKey
            ? await walletKit.getPublicKey()
            : storedAddress;

          if (currentAddress === storedAddress) {
            setWallet({
              address: currentAddress,
              network: selectedNetwork.id,
              provider: "walletconnect",
            });
            setState("connected");
            return;
          }
        }

        await Promise.all([deleteWalletAddress(), deleteConnectionState()]);
      }

      setState("disconnected");
      setWallet({ address: null, network: null, provider: null });
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [walletKit, selectedNetwork.id]);

  useEffect(() => {
    if (walletKit) checkConnectionState();
  }, [walletKit, checkConnectionState]);

  const connect = useCallback(
    async (provider: WalletProviderKind = "walletconnect") => {
      try {
        setState("connecting");
        setError(null);

        let address: string | null = null;

        if (provider === "freighter") {
          address = await requestFreighterAddress();
        } else {
          if (!walletKit) throw new Error("WalletConnect is not available");

          const result: { publicKey?: string; address?: string } =
            await walletKit.connect(selectedNetwork);
          address = result.publicKey ?? result.address ?? null;

          if (typeof walletKit.getPublicKey === "function") {
            address = await walletKit.getPublicKey();
          }
        }

        if (!address) throw new Error("No address returned from wallet");

        const connState: StoredConnectionState = {
          connected: true,
          address,
          timestamp: Date.now(),
        };
        await Promise.all([setWalletAddress(address), setConnectionState(connState)]);

        setWallet({ address, network: selectedNetwork.id, provider });
        setState("connected");
      } catch (err) {
        setState("error");
        setError(err instanceof Error ? err.message : "Connection failed");
        setWallet({ address: null, network: null, provider: null });
      }
    },
    [requestFreighterAddress, selectedNetwork, walletKit]
  );

  const disconnect = useCallback(async () => {
    try {
      setError(null);
      if (walletKit) await walletKit.disconnect();
    } catch {
      // ignore
    } finally {
      await Promise.all([deleteWalletAddress(), deleteConnectionState()]);
      setWallet({ address: null, network: null, provider: null });
      setState("disconnected");
    }
  }, [walletKit]);

  const refresh = useCallback(async () => {
    await checkConnectionState();
  }, [checkConnectionState]);

  useEffect(() => {
    if (wallet.address) {
      setWallet((current) => ({ ...current, network: selectedNetwork.id }));
    }
  }, [selectedNetwork.id, wallet.address]);

  const value: WalletContextType = {
    state,
    wallet,
    network,
    error,
    connect,
    disconnect,
    refresh,
    setNetwork,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWalletContext(): WalletContextType {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWalletContext must be used within a WalletProvider");
  return ctx;
}

export { WalletContext };
