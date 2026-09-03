import { renderHook } from "@testing-library/react-native";
import { useWallet } from "../useWallet";
import { useWalletContext } from "../../context/WalletContext";

jest.mock("../../context/WalletContext", () => ({
  useWalletContext: jest.fn(),
}));

describe("useWallet", () => {
  it("returns the canonical useWallet hook shape when connected", () => {
    const mockWallet = { address: "GBBDQJ...", provider: "freighter" };
    const mockContext = {
      wallet: mockWallet,
      network: "TESTNET",
      state: "connected",
      error: null,
      connect: jest.fn(),
      disconnect: jest.fn(),
      refresh: jest.fn(),
      setNetwork: jest.fn(),
    };

    (useWalletContext as jest.Mock).mockReturnValue(mockContext);

    const { result } = renderHook(() => useWallet());

    expect(result.current).toHaveProperty("address", "GBBDQJ...");
    expect(result.current).toHaveProperty("connected", true);
    expect(result.current).toHaveProperty("network", "TESTNET");
    expect(result.current).toHaveProperty("state", "connected");
    expect(result.current).toHaveProperty("wallet", mockWallet);
    expect(result.current).toHaveProperty("error", null);
    expect(typeof result.current.connect).toBe("function");
    expect(typeof result.current.disconnect).toBe("function");
    expect(typeof result.current.refresh).toBe("function");
    expect(typeof result.current.setNetwork).toBe("function");

    const keys = Object.keys(result.current).sort();
    expect(keys).toEqual([
      "address",
      "connect",
      "connected",
      "disconnect",
      "error",
      "network",
      "refresh",
      "setNetwork",
      "state",
      "wallet",
    ]);
  });

  it("returns correct shape and disconnected status when disconnected", () => {
    const mockWallet = { address: null, provider: null };
    const mockContext = {
      wallet: mockWallet,
      network: "TESTNET",
      state: "disconnected",
      error: "Connection failed",
      connect: jest.fn(),
      disconnect: jest.fn(),
      refresh: jest.fn(),
      setNetwork: jest.fn(),
    };

    (useWalletContext as jest.Mock).mockReturnValue(mockContext);

    const { result } = renderHook(() => useWallet());

    expect(result.current.address).toBeNull();
    expect(result.current.connected).toBe(false);
    expect(result.current.network).toBe("TESTNET");
    expect(result.current.state).toBe("disconnected");
    expect(result.current.error).toBe("Connection failed");
  });
});
