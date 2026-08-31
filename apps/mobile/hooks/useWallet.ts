/**
 * useWallet — convenience hook for consuming the global WalletContext.
 *
 * Returns { address, connected, network, connect, disconnect } as specified
 * by issue #254, plus the full state machine value and error for advanced use.
 *
 * Must be rendered inside <WalletProvider> (added to the root layout).
 */
import { useWalletContext } from "../context/WalletContext";
import type {
  WalletInfo,
  WalletNetwork,
  WalletProviderKind,
  WalletState,
} from "../context/WalletContext";

export interface UseWalletReturn {
  /** Stellar public key, or null when disconnected */
  address: string | null;
  /** True when the wallet is in the "connected" state */
  connected: boolean;
  /** Active network identifier (e.g. "TESTNET") */
  network: WalletNetwork;
  /** Current connection state machine value */
  state: WalletState;
  /** Full wallet object */
  wallet: WalletInfo;
  /** Last connection error */
  error: string | null;
  /** Initiate wallet connection */
  connect: (provider?: WalletProviderKind) => Promise<void>;
  /** Disconnect and clear persisted state */
  disconnect: () => Promise<void>;
  /** Re-check persisted wallet state */
  refresh: () => Promise<void>;
  /** Update the active network preference */
  setNetwork: (network: WalletNetwork) => void;
}

export function useWallet(): UseWalletReturn {
  const { wallet, network, state, error, connect, disconnect, refresh, setNetwork } =
    useWalletContext();

  return {
    address: wallet.address,
    connected: state === "connected",
    network,
    state,
    wallet,
    error,
    connect,
    disconnect,
    refresh,
    setNetwork,
  };
}

export {
  WalletProvider,
  WalletContext,
  useWalletContext,
  type WalletContextType,
  type WalletInfo,
  type WalletNetwork,
  type WalletProviderKind,
  type WalletState,
} from "../context/WalletContext";
