import { decodeCursor, decodeNumericCursor, decodeTimestampCursor, encodeCursor } from "../cursor";

describe("composite cursor encode/decode", () => {
  it("round-trips a value and id", () => {
    const cursor = encodeCursor("42", "post-1");
    expect(decodeCursor(cursor)).toEqual({ value: "42", id: "post-1" });
  });

  it("is opaque base64, not the raw value", () => {
    const cursor = encodeCursor("42", "post-1");
    expect(cursor).not.toContain("42");
    expect(cursor).not.toContain("post-1");
  });

  it("supports a value that itself contains the separator", () => {
    // An ISO timestamp has no '|', but guard the split logic against one anyway:
    // lastIndexOf keeps the id intact even if the value did contain '|'.
    const cursor = encodeCursor("a|b", "id-1");
    expect(decodeCursor(cursor)).toEqual({ value: "a|b", id: "id-1" });
  });

  it("rejects malformed input", () => {
    // Base64 decoding is lenient (invalid characters are just dropped), so
    // "malformed base64" isn't rejected by decoding failing — it's rejected
    // because the decoded bytes don't contain the "value|id" separator.
    expect(decodeCursor("not-base64-!!!")).toBeNull();
    expect(decodeCursor(Buffer.from("no-separator").toString("base64"))).toBeNull();
    expect(decodeCursor(Buffer.from("|missing-value").toString("base64"))).toBeNull();
    expect(decodeCursor(Buffer.from("missing-id|").toString("base64"))).toBeNull();
    expect(decodeCursor(Buffer.from("").toString("base64"))).toBeNull();
  });

  it("decodeNumericCursor parses the value as a number", () => {
    expect(decodeNumericCursor(encodeCursor("123", "p1"))).toEqual({ value: 123, id: "p1" });
    expect(decodeNumericCursor(encodeCursor("-5", "p1"))).toEqual({ value: -5, id: "p1" });
    expect(decodeNumericCursor(encodeCursor("not-a-number", "p1"))).toBeNull();
  });

  it("decodeTimestampCursor parses the value as a Date", () => {
    const iso = "2026-01-01T00:00:00.000Z";
    const result = decodeTimestampCursor(encodeCursor(iso, "p1"));
    expect(result?.id).toBe("p1");
    expect(result?.value.toISOString()).toBe(iso);
    expect(decodeTimestampCursor(encodeCursor("not-a-date", "p1"))).toBeNull();
  });
});
