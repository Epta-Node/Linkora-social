const { isValidDeepLink, parseDeepLink } = require("../utils/deepLinks");

const stellarAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("deep link parsing", () => {
  it("parses post links", () => {
    expect(parseDeepLink("linkora://post/123")).toEqual({
      type: "post",
      path: "/post/123",
    });
  });

  it("parses profile links", () => {
    expect(parseDeepLink(`linkora://profile/${stellarAddress}`)).toEqual({
      type: "profile",
      path: `/profile/${stellarAddress}`,
    });
  });

  it("parses pool links", () => {
    expect(parseDeepLink("linkora://pool/main_pool-1")).toEqual({
      type: "pool",
      path: "/pools/main_pool-1",
    });
  });

  it("supports triple-slash deep links", () => {
    expect(parseDeepLink("linkora:///post/abc_123")).toEqual({
      type: "post",
      path: "/post/abc_123",
    });
  });

  it("parses universal links from linkora.social", () => {
    expect(parseDeepLink("https://linkora.social/post/42")).toEqual({
      type: "post",
      path: "/post/42",
    });
  });

  it("parses direct-message deep links", () => {
    expect(parseDeepLink(`linkora://dm/${stellarAddress}`)).toEqual({
      type: "dm",
      path: `/dm/${stellarAddress}`,
    });
  });

  it("rejects invalid or malformed links", () => {
    expect(parseDeepLink("https://linkora/post/123")).toBeNull();
    expect(parseDeepLink("linkora://post")).toBeNull();
    expect(parseDeepLink("linkora://post/123/extra")).toBeNull();
    expect(parseDeepLink("linkora://profile/not-a-stellar-address")).toBeNull();
    expect(parseDeepLink("linkora://pool/../../settings")).toBeNull();
    expect(parseDeepLink("not a url")).toBeNull();
  });

  it("exposes a boolean validator", () => {
    expect(isValidDeepLink("linkora://post/123")).toBe(true);
    expect(isValidDeepLink("linkora://post/")).toBe(false);
  });
});
