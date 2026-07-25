import { validateManifest, InvalidManifestError } from "..";

describe("validateManifest", () => {
  it("should validate a correct manifest", () => {
    const valid = {
      name: "Test Mini App",
      version: "1.0.0",
      description: "A description",
      entryPoint: "https://example.com/mini",
      icon: "https://example.com/icon.png",
      permissions: ["wallet.read", "post.create"],
    };
    const result = validateManifest(valid);
    expect(result).toEqual(valid);
  });

  it("should throw InvalidManifestError for missing required fields", () => {
    const invalid = {
      name: "Test Mini App",
      version: "1.0.0",
    };
    expect(() => validateManifest(invalid)).toThrow(InvalidManifestError);
  });

  it("should throw InvalidManifestError for invalid permission sets", () => {
    const invalid = {
      name: "Test Mini App",
      version: "1.0.0",
      entryPoint: "https://example.com/mini",
      permissions: ["wallet.read", "invalid.permission"],
    };
    expect(() => validateManifest(invalid)).toThrow(InvalidManifestError);
  });
});
