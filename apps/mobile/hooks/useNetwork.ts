import { useNetworkContext } from "../context/NetworkContext";
import { useNetInfo } from "@react-native-community/netinfo";

export function useNetwork() {
  const networkContext = useNetworkContext();
  const netInfo = useNetInfo();

  return {
    ...networkContext,
    networkLabel: networkContext.network.label,
    isOffline: netInfo.isConnected === false,
  };
}

export { NetworkProvider, useNetworkContext } from "../context/NetworkContext";
