import {
  CONTROL_CHAR_REGEX,
  sanitizeString,
  sanitizeObject,
  ValidationError,
} from "../codec.js";

describe("CONTROL_CHAR_REGEX", () => {
  it("matches null character (U+0000)", () => {
    expect(CONTROL_CHAR_REGEX.test("\x00")).toBe(true);
  });

  it("matches DEL character (U+007F)", () => {
    expect(CONTROL_CHAR_REGEX.test("\x7F")).toBe(true);
  });

  it("matches C0 control characters (U+0001–U+001F)", () => {
    expect(CONTROL_CHAR_REGEX.test("\x01")).toBe(true);
    expect(CONTROL_CHAR_REGEX.test("\x0F")).toBe(true);
    expect(CONTROL_CHAR_REGEX.test("\x1F")).toBe(true);
  });

  it("matches C1 control characters (U+0080–U+009F)", () => {
    expect(CONTROL_CHAR_REGEX.test("\x80")).toBe(true);
    expect(CONTROL_CHAR_REGEX.test("\x9F")).toBe(true);
    expect(CONTROL_CHAR_REGEX.test("\x8F")).toBe(true);
  });

  it("does not match normal ASCII printable characters", () => {
    expect(CONTROL_CHAR_REGEX.test("a")).toBe(false);
    expect(CONTROL_CHAR_REGEX.test("Z")).toBe(false);
    expect(CONTROL_CHAR_REGEX.test("0")).toBe(false);
    expect(CONTROL_CHAR_REGEX.test(" ")).toBe(false);
    expect(CONTROL_CHAR_REGEX.test("!")).toBe(false);
    expect(CONTROL_CHAR_REGEX.test("~")).toBe(false);
  });

  it("does not match Unicode letters above U+009F", () => {
    expect(CONTROL_CHAR_REGEX.test("\u00A0")).toBe(false); // non-breaking space
    expect(CONTROL_CHAR_REGEX.test("\u00E9")).toBe(false); // é
    expect(CONTROL_CHAR_REGEX.test("\u20AC")).toBe(false); // €
    expect(CONTROL_CHAR_REGEX.test("\u{1F600}")).toBe(false); // 😀
  });
});

describe("sanitizeString", () => {
  it("trims whitespace from a clean string", () => {
    expect(sanitizeString("  hello  ", "test")).toBe("hello");
  });

  it("returns the string unchanged if no control characters", () => {
    expect(sanitizeString("normal text", "field")).toBe("normal text");
  });

  it("throws ValidationError for C0 control character", () => {
    expect(() => sanitizeString("hello\x00world", "test")).toThrow(ValidationError);
  });

  it("throws ValidationError for DEL character", () => {
    expect(() => sanitizeString("hello\x7Fworld", "test")).toThrow(ValidationError);
  });

  it("throws ValidationError for C1 control character", () => {
    expect(() => sanitizeString("hello\x80world", "test")).toThrow(ValidationError);
  });

  it("includes field name in the error", () => {
    try {
      sanitizeString("bad\x00value", "myField");
      fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).field).toBe("myField");
      expect((e as ValidationError).message).toContain("myField");
      expect((e as ValidationError).message).toContain("control characters");
    }
  });

  it("uses <root> as field name when not provided", () => {
    try {
      sanitizeString("\x01", "");
      fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).field).toBe("");
    }
  });
});

describe("sanitizeObject", () => {
  it("trims whitespace from string values in an object", () => {
    const input = { name: "  Alice  ", bio: "  hello world  " };
    const result = sanitizeObject(input);
    expect(result).toEqual({ name: "Alice", bio: "hello world" });
  });

  it("trims strings in nested objects", () => {
    const input = { user: { name: "  Bob  ", address: { city: "  NYC  " } } };
    const result = sanitizeObject(input);
    expect(result).toEqual({
      user: { name: "Bob", address: { city: "NYC" } },
    });
  });

  it("trims strings inside arrays", () => {
    const input = ["  hello  ", "  world  "];
    const result = sanitizeObject(input);
    expect(result).toEqual(["hello", "world"]);
  });

  it("trims strings in objects inside arrays", () => {
    const input = [{ name: "  Alice  " }, { name: "  Bob  " }];
    const result = sanitizeObject(input);
    expect(result).toEqual([{ name: "Alice" }, { name: "Bob" }]);
  });

  it("leaves non-string values unchanged", () => {
    const input = { num: 42, big: 100n, bool: true, nil: null };
    const result = sanitizeObject(input);
    expect(result).toEqual({ num: 42, big: 100n, bool: true, nil: null });
  });

  it("throws ValidationError for control characters in nested field", () => {
    const input = { user: { bio: "bad\x00value" } };
    expect(() => sanitizeObject(input)).toThrow(ValidationError);
  });

  it("throws ValidationError for control characters in array elements", () => {
    const input = ["good", "bad\x00value"];
    expect(() => sanitizeObject(input)).toThrow(ValidationError);
  });

  it("returns primitives unchanged", () => {
    expect(sanitizeObject(42)).toBe(42);
    expect(sanitizeObject(true)).toBe(true);
    expect(sanitizeObject(null)).toBe(null);
  });

  it("returns string directly after trimming", () => {
    expect(sanitizeObject("  hello  ")).toBe("hello");
  });

  it("tracks correct path for nested errors", () => {
    const input = { outer: { inner: "bad\x80value" } };
    try {
      sanitizeObject(input);
      fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).field).toBe("outer.inner");
    }
  });
});

describe("ValidationError", () => {
  it("sets name to 'ValidationError'", () => {
    const err = new ValidationError("test", "field", "value");
    expect(err.name).toBe("ValidationError");
  });

  it("stores field and value", () => {
    const err = new ValidationError("msg", "myField", 42);
    expect(err.field).toBe("myField");
    expect(err.value).toBe(42);
  });

  it("is an instance of Error", () => {
    const err = new ValidationError("msg", "f", "v");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ValidationError);
  });
});
