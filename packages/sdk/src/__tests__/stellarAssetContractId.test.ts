import { stellarAssetContractId } from "../classic.js";

describe("stellarAssetContractId (#1633)", () => {
  const TESTNET = "Test SDF Network ; September 2015";

  it("maps native XLM to the testnet native SAC", () => {
    expect(stellarAssetContractId({ asset_type: "native" }, TESTNET)).toBe(
      "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
    );
  });

  it("derives a deterministic contract id for an issued asset", () => {
    const balance = {
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    };
    const id = stellarAssetContractId(balance, TESTNET);
    expect(id).toMatch(/^C[A-Z2-7]{55}$/);
    expect(stellarAssetContractId(balance, TESTNET)).toBe(id);
    expect(
      stellarAssetContractId(balance, "Public Global Stellar Network ; September 2015")
    ).not.toBe(id);
  });

  it("returns null for balances without a SAC", () => {
    expect(stellarAssetContractId({ asset_type: "liquidity_pool_shares" }, TESTNET)).toBeNull();
    expect(
      stellarAssetContractId({ asset_type: "credit_alphanum4", asset_code: "USDC" }, TESTNET)
    ).toBeNull();
    expect(
      stellarAssetContractId(
        { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "bad" },
        TESTNET
      )
    ).toBeNull();
  });
});
