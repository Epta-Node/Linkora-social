import { contentHash } from "../contentHash";

describe("contentHash", () => {
  it("is deterministic for the same author and content", () => {
    expect(contentHash("GAUTHOR", "hello")).toBe(contentHash("GAUTHOR", "hello"));
  });

  it("differs when content differs", () => {
    expect(contentHash("GAUTHOR", "hello")).not.toBe(contentHash("GAUTHOR", "world"));
  });

  it("differs when author differs", () => {
    expect(contentHash("GAUTHOR1", "hello")).not.toBe(contentHash("GAUTHOR2", "hello"));
  });

  it("produces an 8-char hex string", () => {
    expect(contentHash("GAUTHOR", "hello")).toMatch(/^[0-9a-f]{8}$/);
  });
});
