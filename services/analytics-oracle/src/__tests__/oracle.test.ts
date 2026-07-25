import { getPublicKey, verify } from "@noble/ed25519";
import { encodeReport } from "../codec.js";
import { signReport } from "../signer.js";
import { hashReport } from "../codec.js";
import { AnalyticsReport } from "../types.js";

const SEED = new Uint8Array(32).fill(7); // deterministic test key

const REPORT: AnalyticsReport = {
  version: 1,
  creator: new Uint8Array(32).fill(1),
  windowStart: 1000n,
  windowEnd: 2000n,
  totalTips: 5_000_000n,
  postCount: 3n,
  followerDelta: 10n,
  uniqueTippers: 2,
};

describe("codec", () => {
  it("encodeReport produces non-empty Buffer", () => {
    const cbor = encodeReport(REPORT);
    expect(cbor).toBeInstanceOf(Buffer);
    expect(cbor.length).toBeGreaterThan(0);
  });

  it("encodeReport is deterministic", () => {
    expect(encodeReport(REPORT).toString("hex")).toBe(
      encodeReport({ ...REPORT }).toString("hex")
    );
  });

  it("different reports produce different CBOR", () => {
    const other = encodeReport({ ...REPORT, postCount: 99n });
    expect(encodeReport(REPORT).toString("hex")).not.toBe(other.toString("hex"));
  });
});

describe("signer", () => {
  it("signature verifies against pubkey", async () => {
    const cbor = encodeReport(REPORT);
    const { signature, reportHash } = await signReport(cbor, SEED);
    const pubkey = await getPublicKey(SEED);
    const valid = await verify(signature, reportHash, pubkey);
    expect(valid).toBe(true);
  });

  it("flipped signature bit fails verification", async () => {
    const cbor = encodeReport(REPORT);
    const { signature, reportHash } = await signReport(cbor, SEED);
    const bad = Buffer.from(signature);
    bad[0] ^= 0xff;
    const pubkey = await getPublicKey(SEED);
    const valid = await verify(bad, reportHash, pubkey);
    expect(valid).toBe(false);
  });

  it("different report produces different hash", async () => {
    const cbor1 = encodeReport(REPORT);
    const cbor2 = encodeReport({ ...REPORT, postCount: 99n });
    const h1 = await hashReport(cbor1);
    const h2 = await hashReport(cbor2);
    expect(h1.toString("hex")).not.toBe(h2.toString("hex"));
  });
});
