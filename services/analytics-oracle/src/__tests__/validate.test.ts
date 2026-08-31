import { validateReport, ValidationError, encodeReport } from "../codec.js";
import { AnalyticsReport } from "../types.js";

const VALID_REPORT: AnalyticsReport = {
  version: 1,
  creator: new Uint8Array(32).fill(1),
  windowStart: 1000n,
  windowEnd: 2000n,
  totalTips: 5_000_000n,
  postCount: 3n,
  followerDelta: 10n,
  uniqueTippers: 2,
};

describe("validateReport", () => {
  describe("version", () => {
    it("accepts version 0", () => {
      expect(() => validateReport({ ...VALID_REPORT, version: 0 })).not.toThrow();
    });

    it("accepts version 255", () => {
      expect(() => validateReport({ ...VALID_REPORT, version: 255 })).not.toThrow();
    });

    it("rejects negative version", () => {
      expect(() => validateReport({ ...VALID_REPORT, version: -1 })).toThrow(ValidationError);
    });

    it("rejects version > 255", () => {
      expect(() => validateReport({ ...VALID_REPORT, version: 256 })).toThrow(ValidationError);
    });

    it("rejects non-integer version", () => {
      expect(() => validateReport({ ...VALID_REPORT, version: 1.5 })).toThrow(ValidationError);
    });

    it("includes field name in error", () => {
      try {
        validateReport({ ...VALID_REPORT, version: 256 });
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        expect((e as ValidationError).field).toBe("version");
      }
    });
  });

  describe("creator", () => {
    it("accepts 32-byte Uint8Array", () => {
      expect(() => validateReport({ ...VALID_REPORT, creator: new Uint8Array(32) })).not.toThrow();
    });

    it("rejects non-Uint8Array", () => {
      expect(() =>
        validateReport({ ...VALID_REPORT, creator: new Array(32) as unknown as Uint8Array })
      ).toThrow(ValidationError);
    });

    it("rejects 31-byte creator", () => {
      expect(() => validateReport({ ...VALID_REPORT, creator: new Uint8Array(31) })).toThrow(
        ValidationError
      );
    });

    it("rejects 33-byte creator", () => {
      expect(() => validateReport({ ...VALID_REPORT, creator: new Uint8Array(33) })).toThrow(
        ValidationError
      );
    });

    it("includes field name in error", () => {
      try {
        validateReport({ ...VALID_REPORT, creator: new Uint8Array(10) });
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        expect((e as ValidationError).field).toBe("creator");
      }
    });
  });

  describe("windowStart", () => {
    it("accepts positive windowStart", () => {
      expect(() => validateReport({ ...VALID_REPORT, windowStart: 1n })).not.toThrow();
    });

    it("rejects zero windowStart", () => {
      expect(() => validateReport({ ...VALID_REPORT, windowStart: 0n })).toThrow(ValidationError);
    });

    it("rejects negative windowStart", () => {
      expect(() => validateReport({ ...VALID_REPORT, windowStart: -1n })).toThrow(ValidationError);
    });

    it("includes field name in error", () => {
      try {
        validateReport({ ...VALID_REPORT, windowStart: 0n });
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        expect((e as ValidationError).field).toBe("windowStart");
      }
    });
  });

  describe("windowEnd", () => {
    it("accepts positive windowEnd", () => {
      expect(() =>
        validateReport({ ...VALID_REPORT, windowStart: 1n, windowEnd: 2n })
      ).not.toThrow();
    });

    it("rejects zero windowEnd", () => {
      expect(() => validateReport({ ...VALID_REPORT, windowEnd: 0n })).toThrow(ValidationError);
    });

    it("rejects negative windowEnd", () => {
      expect(() => validateReport({ ...VALID_REPORT, windowEnd: -1n })).toThrow(ValidationError);
    });
  });

  describe("windowStart < windowEnd", () => {
    it("rejects windowStart equal to windowEnd", () => {
      expect(() =>
        validateReport({ ...VALID_REPORT, windowStart: 1000n, windowEnd: 1000n })
      ).toThrow(ValidationError);
    });

    it("rejects windowStart greater than windowEnd", () => {
      expect(() =>
        validateReport({ ...VALID_REPORT, windowStart: 2000n, windowEnd: 1000n })
      ).toThrow(ValidationError);
    });

    it("includes windowStart field in error", () => {
      try {
        validateReport({ ...VALID_REPORT, windowStart: 2000n, windowEnd: 1000n });
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        expect((e as ValidationError).field).toBe("windowStart");
      }
    });
  });

  describe("totalTips", () => {
    it("accepts zero totalTips", () => {
      expect(() => validateReport({ ...VALID_REPORT, totalTips: 0n })).not.toThrow();
    });

    it("rejects negative totalTips", () => {
      expect(() => validateReport({ ...VALID_REPORT, totalTips: -1n })).toThrow(ValidationError);
    });

    it("includes field name in error", () => {
      try {
        validateReport({ ...VALID_REPORT, totalTips: -5n });
      } catch (e) {
        expect((e as ValidationError).field).toBe("totalTips");
      }
    });
  });

  describe("postCount", () => {
    it("accepts zero postCount", () => {
      expect(() => validateReport({ ...VALID_REPORT, postCount: 0n })).not.toThrow();
    });

    it("rejects negative postCount", () => {
      expect(() => validateReport({ ...VALID_REPORT, postCount: -1n })).toThrow(ValidationError);
    });
  });

  describe("followerDelta", () => {
    it("accepts zero followerDelta", () => {
      expect(() => validateReport({ ...VALID_REPORT, followerDelta: 0n })).not.toThrow();
    });

    it("rejects negative followerDelta", () => {
      expect(() => validateReport({ ...VALID_REPORT, followerDelta: -1n })).toThrow(
        ValidationError
      );
    });

    it("includes field name in error", () => {
      try {
        validateReport({ ...VALID_REPORT, followerDelta: -5n });
      } catch (e) {
        expect((e as ValidationError).field).toBe("followerDelta");
      }
    });
  });

  describe("uniqueTippers", () => {
    it("accepts zero uniqueTippers", () => {
      expect(() => validateReport({ ...VALID_REPORT, uniqueTippers: 0 })).not.toThrow();
    });

    it("rejects negative uniqueTippers", () => {
      expect(() => validateReport({ ...VALID_REPORT, uniqueTippers: -1 })).toThrow(ValidationError);
    });

    it("rejects non-integer uniqueTippers", () => {
      expect(() => validateReport({ ...VALID_REPORT, uniqueTippers: 1.5 })).toThrow(
        ValidationError
      );
    });

    it("includes field name in error", () => {
      try {
        validateReport({ ...VALID_REPORT, uniqueTippers: -1 });
      } catch (e) {
        expect((e as ValidationError).field).toBe("uniqueTippers");
      }
    });
  });
});

describe("encodeReport (with validation)", () => {
  it("encodes a valid report without error", () => {
    expect(() => encodeReport(VALID_REPORT)).not.toThrow();
    const buf = encodeReport(VALID_REPORT);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("throws ValidationError for invalid report", () => {
    expect(() => encodeReport({ ...VALID_REPORT, version: 999 })).toThrow(ValidationError);
  });
});
