import { getHorizonUrl, HORIZON_ENDPOINTS, DEFAULT_HORIZON_ENDPOINT } from "./networks";

describe("networks config", () => {
  it("resolves testnet endpoint for TESTNET network", () => {
    expect(getHorizonUrl("TESTNET")).toBe("https://horizon-testnet.stellar.org");
    expect(getHorizonUrl("testnet")).toBe("https://horizon-testnet.stellar.org");
  });

  it("resolves mainnet/public endpoint for PUBLIC and MAINNET networks", () => {
    expect(getHorizonUrl("PUBLIC")).toBe("https://horizon.stellar.org");
    expect(getHorizonUrl("MAINNET")).toBe("https://horizon.stellar.org");
    expect(getHorizonUrl("public")).toBe("https://horizon.stellar.org");
  });

  it("resolves futurenet endpoint for FUTURENET network", () => {
    expect(getHorizonUrl("FUTURENET")).toBe("https://horizon-futurenet.stellar.org");
  });

  it("resolves to default endpoint when network is null, undefined, or unknown", () => {
    expect(getHorizonUrl(null)).toBe(DEFAULT_HORIZON_ENDPOINT);
    expect(getHorizonUrl(undefined)).toBe(DEFAULT_HORIZON_ENDPOINT);
    expect(getHorizonUrl("UNKNOWN_NET")).toBe(DEFAULT_HORIZON_ENDPOINT);
  });
});
