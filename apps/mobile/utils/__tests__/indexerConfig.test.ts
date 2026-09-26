import { getIndexerBaseUrl } from "../indexerConfig";

describe("getIndexerBaseUrl", () => {
  it("fails fast naming the missing variable when unset", () => {
    expect(() => getIndexerBaseUrl({})).toThrow(/EXPO_PUBLIC_INDEXER_URL/);
  });

  it("rejects a non-https URL outside the local-development profile", () => {
    expect(() => getIndexerBaseUrl({ EXPO_PUBLIC_INDEXER_URL: "http://example.com" })).toThrow(
      /https/
    );
  });

  it("allows http:// only when EXPO_PUBLIC_LOCAL_DEV=1", () => {
    expect(
      getIndexerBaseUrl({
        EXPO_PUBLIC_INDEXER_URL: "http://localhost:3001",
        EXPO_PUBLIC_LOCAL_DEV: "1",
      })
    ).toBe("http://localhost:3001");
  });

  it("accepts and normalizes a trailing slash on an https URL", () => {
    expect(getIndexerBaseUrl({ EXPO_PUBLIC_INDEXER_URL: "https://indexer.example.com/" })).toBe(
      "https://indexer.example.com"
    );
  });
});
