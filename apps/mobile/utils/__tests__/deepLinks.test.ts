import { isValidDeepLink, parseDeepLink, parseRoutePath } from "../deepLinks";

const ADDRESS = "GCKFBEIYTKP6RCZNVPH73XL7XFWTEOAO4MKONX7HOILHDVBMW5EVPOPZ";

describe("parseDeepLink", () => {
  it("parses a valid linkora post link", () => {
    expect(parseDeepLink("linkora://post/abc-123")).toEqual({
      type: "post",
      path: "/post/abc-123",
    });
  });

  it("parses a valid universal link", () => {
    expect(parseDeepLink("https://linkora.social/pool/creator-fund")).toEqual({
      type: "pool",
      path: "/pools/creator-fund",
    });
  });

  it("parses profile and dm links for a Stellar address", () => {
    expect(parseDeepLink(`linkora://profile/${ADDRESS}`)).toEqual({
      type: "profile",
      path: `/profile/${ADDRESS}`,
    });
    expect(parseDeepLink(`linkora://dm/${ADDRESS}`)).toEqual({
      type: "dm",
      path: `/dm/${ADDRESS}`,
    });
  });

  // #1555 — each rejected form gets its own case: a traversal, a query string,
  // a fragment, an encoded separator and a non-whitelisted resource.
  it("rejects a traversal payload (#1555)", () => {
    expect(parseDeepLink("linkora://post/../../settings")).toBeNull();
    expect(parseDeepLink("linkora://post/..")).toBeNull();
    expect(isValidDeepLink("linkora://post/../../settings")).toBe(false);
  });

  it("rejects an identifier carrying a query string (#1555)", () => {
    expect(parseDeepLink("linkora://post/x?a=b")).toBeNull();
    expect(parseDeepLink("https://linkora.social/post/x?a=b")).toBeNull();
  });

  it("rejects an identifier carrying a fragment (#1555)", () => {
    expect(parseDeepLink("linkora://post/x#section")).toBeNull();
  });

  it("rejects an encoded path separator smuggled into the identifier (#1555)", () => {
    expect(parseDeepLink("linkora://post/x%2F..%2Fsettings")).toBeNull();
    expect(parseDeepLink("linkora://post/x%3Fa=b")).toBeNull();
  });

  it("rejects unknown resources and malformed URLs", () => {
    expect(parseDeepLink("linkora://settings/general")).toBeNull();
    expect(parseDeepLink("linkora://post")).toBeNull();
    expect(parseDeepLink("linkora://post/a/b")).toBeNull();
    expect(parseDeepLink("https://evil.example.com/post/abc")).toBeNull();
    expect(parseDeepLink("javascript:alert(1)")).toBeNull();
  });

  it("rejects a profile identifier that is not a Stellar address", () => {
    expect(parseDeepLink("linkora://profile/../../settings")).toBeNull();
    expect(parseDeepLink("linkora://profile/not-an-address")).toBeNull();
  });
});

describe("parseRoutePath (#1555)", () => {
  it("validates a bare in-app path through the same rules as a deep link", () => {
    expect(parseRoutePath("/post/abc-123")).toEqual({ type: "post", path: "/post/abc-123" });
    expect(parseRoutePath(`/pools/${"creator-fund"}`)).toEqual({
      type: "pool",
      path: "/pools/creator-fund",
    });
    expect(parseRoutePath(`/profile/${ADDRESS}`)).toEqual({
      type: "profile",
      path: `/profile/${ADDRESS}`,
    });
  });

  it("rejects a bare path that would not survive parseDeepLink", () => {
    expect(parseRoutePath("/post/../../settings")).toBeNull();
    expect(parseRoutePath("/post/x?a=b")).toBeNull();
    expect(parseRoutePath("/settings/general")).toBeNull();
    expect(parseRoutePath("post/abc-123")).toBeNull();
  });

  it("routes identically for the cold-start and warm forms of the same target", () => {
    const warm = parseDeepLink("linkora://post/abc-123");
    const cold = parseRoutePath("/post/abc-123");
    expect(cold).toEqual(warm);
  });
});
