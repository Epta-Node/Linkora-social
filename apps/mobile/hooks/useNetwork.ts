import { useNetworkContext } from "../context/NetworkContext";

export function useNetwork() {
  const networkContext = useNetworkContext();

  return {
    ...networkContext,
    networkLabel: networkContext.network.label,
  };
}

export { NetworkProvider, useNetworkContext } from "../context/NetworkContext";
