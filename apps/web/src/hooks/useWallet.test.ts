import { fetchXlmBalance } from "./useWallet";

describe("fetchXlmBalance", () => {
  beforeEach(() => {
    // @ts-ignore
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("queries the testnet Horizon endpoint when network is TESTNET", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        balances: [{ asset_type: "native", balance: "100.5000000" }],
      }),
    });

    const bal = await fetchXlmBalance("GXXXXXXXXXXXXXX", "TESTNET");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://horizon-testnet.stellar.org/accounts/GXXXXXXXXXXXXXX"
    );
    expect(bal).toBe("100.5000000");
  });

  it("queries the mainnet Horizon endpoint when network is PUBLIC or MAINNET", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        balances: [{ asset_type: "native", balance: "500.2500000" }],
      }),
    });

    const bal = await fetchXlmBalance("GXXXXXXXXXXXXXX", "PUBLIC");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://horizon.stellar.org/accounts/GXXXXXXXXXXXXXX"
    );
    expect(bal).toBe("500.2500000");
  });

  it("falls back to default endpoint when network is not specified", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        balances: [{ asset_type: "native", balance: "10.0000000" }],
      }),
    });

    const bal = await fetchXlmBalance("GXXXXXXXXXXXXXX");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://horizon-testnet.stellar.org/accounts/GXXXXXXXXXXXXXX"
    );
    expect(bal).toBe("10.0000000");
  });
});
