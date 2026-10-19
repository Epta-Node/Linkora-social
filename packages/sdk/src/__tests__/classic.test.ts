import { ClassicAccountClient, resolveHorizonUrl } from "../classic.js";
import { ValidationError, NetworkError } from "../errors.js";

describe("Issue #1361: Classic Account & Horizon helpers", () => {
  describe("resolveHorizonUrl", () => {
    it("resolves testnet URL for test network passphrase", () => {
      const url = resolveHorizonUrl("Test SDF Network ; September 2015");
      expect(url).toBe("https://horizon-testnet.stellar.org");
    });

    it("resolves pubnet URL for global stellar passphrase", () => {
      const url = resolveHorizonUrl("Public Global Stellar Network ; September 2015");
      expect(url).toBe("https://horizon.stellar.org");
    });

    it("uses explicitly provided horizonUrl", () => {
      const url = resolveHorizonUrl("Custom Passphrase", "https://custom-horizon.com");
      expect(url).toBe("https://custom-horizon.com");
    });

    it("throws ValidationError when custom network has no horizonUrl", () => {
      expect(() => resolveHorizonUrl("Unknown Custom Passphrase")).toThrow(ValidationError);
    });
  });

  describe("ClassicAccountClient", () => {
    it("fetches account balances and formats native XLM", async () => {
      const client = new ClassicAccountClient({ horizonUrl: "https://horizon-testnet.stellar.org" });

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "GUSER",
          account_id: "GUSER",
          sequence: "100",
          balances: [
            { asset_type: "native", balance: "150.5" },
            { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "GISSUER", balance: "10.0" },
          ],
        }),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      const balances = await client.getAccountBalances("GUSER");
      expect(balances.length).toBe(2);
      expect(balances[0]).toEqual({
        asset_type: "native",
        asset_code: "XLM",
        asset_issuer: "",
        balance: "150.5",
      });

      const trustlines = await client.getAccountTrustlines("GUSER");
      expect(trustlines.length).toBe(1);
      expect(trustlines[0].asset_code).toBe("USDC");
    });

    it("throws NetworkError on Horizon HTTP failure", async () => {
      const client = new ClassicAccountClient({ horizonUrl: "https://horizon-testnet.stellar.org" });

      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      await expect(client.getAccount("GUSER")).rejects.toThrow(NetworkError);
    });
  });
});
