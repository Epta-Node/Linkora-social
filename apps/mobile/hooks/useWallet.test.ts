import { renderHook } from "@testing-library/react-native";
import { useWallet } from "./useWallet";
import { useWalletContext } from "../context/WalletContext";

jest.mock("../context/WalletContext", () => ({
  useWalletContext: jest.fn(),
}));

describe("useWallet", () => {
  it("returns wallet state correctly when connected", () => {
    const mockContext = {
      wallet: { address: "GBBDQJ..." },
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

    expect(result.current.address).toBe("GBBDQJ...");
    expect(result.current.connected).toBe(true);
    expect(result.current.network).toBe("TESTNET");
    expect(result.current.error).toBeNull();
  });

  it("returns wallet state correctly when disconnected", () => {
    const mockContext = {
      wallet: { address: null },
      network: null,
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
    expect(result.current.network).toBeNull();
    expect(result.current.error).toBe("Connection failed");
  });
});
