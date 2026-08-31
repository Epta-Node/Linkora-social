import { createHash } from "crypto";
import { Request, Response } from "express";
import { idempotencyMiddleware, IDEMPOTENCY_KEY_HEADER } from "../idempotency";
import { Database } from "../../database";

const SENDER = "GSENDERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

// Mirrors the canonicalization in ../idempotency.ts so the expected
// fingerprint doesn't depend on object key insertion order.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const result: Record<string, unknown> = {};
    for (const [k, v] of entries) result[k] = canonicalize(v);
    return result;
  }
  return value;
}

function fingerprint(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(body ?? {}))).digest("hex");
}

function makeReq(
  headers: Record<string, string> = {},
  opts: { stellarAddress?: string; body?: unknown } = {}
): Request {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;

  return {
    header: (name: string) => lower[name.toLowerCase()],
    requestId: "req-1",
    stellarAddress: "stellarAddress" in opts ? opts.stellarAddress : SENDER,
    body: opts.body ?? {},
  } as unknown as Request;
}

interface FakeRes extends Response {
  body?: unknown;
}

function makeRes(): FakeRes {
  const res = {} as FakeRes;
  res.statusCode = 200;
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response["status"];
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res;
  }) as unknown as Response["json"];
  return res;
}

function fakeDatabase(overrides: Partial<Database> = {}): Database {
  return {
    claimIdempotencyKey: jest.fn(),
    getIdempotencyResponse: jest.fn(),
    completeIdempotencyKey: jest.fn(),
    ...overrides,
  } as unknown as Database;
}

describe("idempotencyMiddleware", () => {
  it("rejects a request missing the idempotency key header with 400", async () => {
    const database = fakeDatabase();
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await idempotencyMiddleware(database)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a malformed (non-UUID) idempotency key with 400", async () => {
    const database = fakeDatabase();
    const req = makeReq({ [IDEMPOTENCY_KEY_HEADER]: "not-a-uuid" });
    const res = makeRes();
    const next = jest.fn();

    await idempotencyMiddleware(database)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a request with no authenticated sender with 401", async () => {
    const database = fakeDatabase();
    const key = "00000000-0000-0000-0000-000000000000";
    const req = makeReq({ [IDEMPOTENCY_KEY_HEADER]: key }, { stellarAddress: undefined });
    const res = makeRes();
    const next = jest.fn();

    await idempotencyMiddleware(database)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(database.claimIdempotencyKey).not.toHaveBeenCalled();
  });

  it("processes a new key, calls next(), and persists the resulting response scoped to the sender", async () => {
    const claimIdempotencyKey = jest.fn().mockResolvedValue({ status: "claimed" });
    const completeIdempotencyKey = jest.fn().mockResolvedValue(undefined);
    const database = fakeDatabase({ claimIdempotencyKey, completeIdempotencyKey });

    const key = "11111111-1111-1111-1111-111111111111";
    const body = { sender: SENDER, recipient: "GRECIPIENT", ciphertext_b64: "abc" };
    const req = makeReq({ [IDEMPOTENCY_KEY_HEADER]: key }, { body });
    const res = makeRes();
    const next = jest.fn(() => {
      res.status(201).json({ success: true, message_id: "m1" });
    });

    await idempotencyMiddleware(database)(req, res, next);

    expect(claimIdempotencyKey).toHaveBeenCalledWith(SENDER, key, fingerprint(body));
    expect(next).toHaveBeenCalled();
    expect(res.body).toEqual({ success: true, message_id: "m1" });
    expect(completeIdempotencyKey).toHaveBeenCalledWith(SENDER, key, 201, {
      success: true,
      message_id: "m1",
    });
  });

  it("replays the cached response for a duplicate key without calling next()", async () => {
    const claimIdempotencyKey = jest.fn().mockResolvedValue({
      status: "cached",
      responseStatus: 201,
      responseBody: { success: true, message_id: "abc" },
    });
    const database = fakeDatabase({ claimIdempotencyKey });

    const key = "22222222-2222-2222-2222-222222222222";
    const req = makeReq({ [IDEMPOTENCY_KEY_HEADER]: key });
    const res = makeRes();
    const next = jest.fn();

    await idempotencyMiddleware(database)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body).toEqual({ success: true, message_id: "abc" });
  });

  it("returns 409 when the same sender reuses a key with a different payload", async () => {
    const claimIdempotencyKey = jest.fn().mockResolvedValue({ status: "conflict" });
    const database = fakeDatabase({ claimIdempotencyKey });

    const key = "99999999-9999-9999-9999-999999999999";
    const req = makeReq({ [IDEMPOTENCY_KEY_HEADER]: key }, { body: { recipient: "GOTHER" } });
    const res = makeRes();
    const next = jest.fn();

    await idempotencyMiddleware(database)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("polls and replays the response once a concurrent duplicate finishes", async () => {
    const claimIdempotencyKey = jest.fn().mockResolvedValue({ status: "in_progress" });
    const getIdempotencyResponse = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ responseStatus: 201, responseBody: { message_id: "xyz" } });
    const database = fakeDatabase({ claimIdempotencyKey, getIdempotencyResponse });

    const key = "33333333-3333-3333-3333-333333333333";
    const req = makeReq({ [IDEMPOTENCY_KEY_HEADER]: key });
    const res = makeRes();
    const next = jest.fn();

    await idempotencyMiddleware(database)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body).toEqual({ message_id: "xyz" });
    expect(getIdempotencyResponse).toHaveBeenCalledTimes(2);
    expect(getIdempotencyResponse).toHaveBeenCalledWith(SENDER, key);
  });

  it("returns 409 if a concurrent duplicate never completes within the wait window", async () => {
    const claimIdempotencyKey = jest.fn().mockResolvedValue({ status: "in_progress" });
    const getIdempotencyResponse = jest.fn().mockResolvedValue(null);
    const database = fakeDatabase({ claimIdempotencyKey, getIdempotencyResponse });

    const key = "44444444-4444-4444-4444-444444444444";
    const req = makeReq({ [IDEMPOTENCY_KEY_HEADER]: key });
    const res = makeRes();
    const next = jest.fn();

    await idempotencyMiddleware(database)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  }, 10000);
});
