import { isAllowedNavigation, originOf } from "../[id]";

describe("mini-app WebView origin pinning (#1551)", () => {
  it("extracts the origin of a URL", () => {
    expect(originOf("https://linkora-social.github.io/mini-apps/tip-jar/index.html")).toBe(
      "https://linkora-social.github.io"
    );
  });

  it("returns null for an unparseable URL", () => {
    expect(originOf("not a url")).toBeNull();
  });

  it("allows navigation that stays within the installed app's origin", () => {
    const allowed = originOf("https://linkora-social.github.io/mini-apps/tip-jar/index.html");
    expect(
      isAllowedNavigation(allowed, "https://linkora-social.github.io/mini-apps/tip-jar/tip.html")
    ).toBe(true);
  });

  it("blocks a tampered-route navigation to a different origin (#1551)", () => {
    const allowed = originOf("https://linkora-social.github.io/mini-apps/tip-jar/index.html");
    expect(isAllowedNavigation(allowed, "https://evil.example")).toBe(false);
  });

  it("blocks navigation when the installed app couldn't be resolved at all", () => {
    expect(isAllowedNavigation(null, "https://linkora-social.github.io/mini-apps/tip-jar/")).toBe(
      false
    );
  });
});
