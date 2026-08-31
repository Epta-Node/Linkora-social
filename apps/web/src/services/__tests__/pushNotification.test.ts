import { createHash } from "crypto";
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from "util";
import { buildAuthMessage } from "@linkora/types/src/auth";

function toBuffer(data: BufferSource): Buffer {
  return ArrayBuffer.isView(data)
    ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    : Buffer.from(data);
}

// jsdom provides no `crypto.subtle`, and Node's webcrypto rejects an ArrayBuffer
// built inside Jest's jsdom realm. Both are sidestepped with a SHA-256 shim over
// node:crypto, installed before the module under test is imported.
Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: {
    subtle: {
      digest: async (_algorithm: string, data: BufferSource): Promise<ArrayBuffer> => {
        const digest = createHash("sha256").update(toBuffer(data)).digest();
        return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
      },
    },
  },
});

if (typeof globalThis.TextEncoder === "undefined") {
  globalThis.TextEncoder = NodeTextEncoder as unknown as typeof globalThis.TextEncoder;
  globalThis.TextDecoder = NodeTextDecoder as unknown as typeof globalThis.TextDecoder;
}

// jest.setup.ts mocks @stellar/freighter-api without signBlob — override it here
// so the blob handed to the wallet can be captured.
const signBlob = jest.fn(async (_payload: string, _opts: { accountToSign: string }) => "c2ln");
jest.mock("@stellar/freighter-api", () => ({
  signBlob: (...args: unknown[]) => signBlob(...(args as [string, { accountToSign: string }])),
}));

import { fetchPreferencesFromServer, savePreferencesToBackend } from "../pushNotification";

const ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const INDEXER_URL = "http://localhost:3001";

interface CapturedRequest {
  url: string;
  method: string;
  body: string | undefined;
  authHeader: string;
}

let captured: CapturedRequest;

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** What the wallet is handed to sign: base64 of the message digest. */
function sha256Base64(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("base64");
}

/** Decodes the `StellarSig <base64>` header back into its JSON payload. */
function decodeAuthHeader(header: string): { address: string; timestamp: number } {
  const [scheme, base64Payload] = header.split(" ");
  expect(scheme).toBe("StellarSig");
  return JSON.parse(Buffer.from(base64Payload, "base64").toString("utf8"));
}

beforeEach(() => {
  signBlob.mockClear();
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    captured = {
      url,
      method: init.method as string,
      body: init.body as string | undefined,
      authHeader: (init.headers as Record<string, string>)["Authorization"],
    };
    return { ok: true, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
});

describe("signed indexer requests", () => {
  it("signs the exact body string that is sent (hash and payload cannot drift)", async () => {
    await savePreferencesToBackend(ADDRESS, { newFollowers: true }, null);

    const { timestamp } = decodeAuthHeader(captured.authHeader);

    // The invariant: hash the bytes fetch actually received, and the message
    // rebuilt from them must be the one the wallet was asked to sign.
    expect(captured.body).toBeDefined();
    const expected = sha256Base64(
      buildAuthMessage({
        method: "POST",
        canonicalPath: "/api/notifications/preferences",
        address: ADDRESS,
        timestamp,
        bodyHash: sha256Hex(captured.body as string),
      })
    );

    expect(signBlob).toHaveBeenCalledTimes(1);
    expect(signBlob.mock.calls[0][0]).toBe(expected);
    expect(signBlob.mock.calls[0][1]).toEqual({ accountToSign: ADDRESS });
  });

  // Note: this only pins the payload shape. Two separate JSON.stringify calls on
  // the same object yield the same string, so no assertion on output can prove
  // single serialisation — that is enforced by the type of SignedRequestSpec.body
  // and guarded by the hash-matches-sent-bytes test above.
  it("sends the caller's payload verbatim as JSON", async () => {
    const preferences = { newFollowers: true, mentions: false };
    await savePreferencesToBackend(ADDRESS, preferences, null);

    expect(captured.body).toBe(JSON.stringify({ preferences, subscription: null }));
  });

  it("signs the absolute path including the mount prefix", async () => {
    await savePreferencesToBackend(ADDRESS, {}, null);

    const { timestamp } = decodeAuthHeader(captured.authHeader);
    const bodyHash = sha256Hex(captured.body as string);

    const withPrefix = sha256Base64(
      buildAuthMessage({
        method: "POST",
        canonicalPath: "/api/notifications/preferences",
        address: ADDRESS,
        timestamp,
        bodyHash,
      })
    );
    const withoutPrefix = sha256Base64(
      buildAuthMessage({
        method: "POST",
        canonicalPath: "/preferences",
        address: ADDRESS,
        timestamp,
        bodyHash,
      })
    );

    expect(signBlob.mock.calls[0][0]).toBe(withPrefix);
    expect(signBlob.mock.calls[0][0]).not.toBe(withoutPrefix);
    expect(captured.url).toBe(`${INDEXER_URL}/api/notifications/preferences`);
  });

  it("hashes the empty string for a body-less GET and sends no body", async () => {
    await fetchPreferencesFromServer(ADDRESS);

    const { timestamp } = decodeAuthHeader(captured.authHeader);
    const expected = sha256Base64(
      buildAuthMessage({
        method: "GET",
        canonicalPath: "/api/notifications/preferences",
        address: ADDRESS,
        timestamp,
        bodyHash: sha256Hex(""),
      })
    );

    expect(captured.method).toBe("GET");
    expect(captured.body).toBeUndefined();
    expect(signBlob.mock.calls[0][0]).toBe(expected);
  });

  it("produces a different signature for GET and POST on the same path", async () => {
    await fetchPreferencesFromServer(ADDRESS);
    const getBlob = signBlob.mock.calls[0][0];
    const getTimestamp = decodeAuthHeader(captured.authHeader).timestamp;

    signBlob.mockClear();
    await savePreferencesToBackend(ADDRESS, {}, null);
    const postTimestamp = decodeAuthHeader(captured.authHeader).timestamp;

    // Only compare when the clock did not move, so the difference can only come
    // from the method and body rather than from the timestamp.
    if (getTimestamp === postTimestamp) {
      expect(signBlob.mock.calls[0][0]).not.toBe(getBlob);
    }
  });

  it("sets a JSON content type only when there is a body", async () => {
    await savePreferencesToBackend(ADDRESS, {}, null);
    const postInit = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(postInit.headers["Content-Type"]).toBe("application/json");

    await fetchPreferencesFromServer(ADDRESS);
    const getInit = (global.fetch as jest.Mock).mock.calls[1][1];
    expect(getInit.headers["Content-Type"]).toBeUndefined();
  });
});
