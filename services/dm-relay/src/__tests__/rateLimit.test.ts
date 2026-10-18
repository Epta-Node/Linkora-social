/**
 * Tests for per-conversation rate limiting (#1650)
 *
 * Verifies that:
 *  - burst within limit passes
 *  - exceeding the limit returns 429 with code RATE_LIMIT_CONVERSATION
 *  - global sender limit returns 429 with code RATE_LIMIT_SENDER
 */

import { buildRateLimitMiddleware, RateLimitConfig } from "../middleware/rateLimit";
import { Request, Response } from "express";

function makeReq(sender: string, recipient: string): Partial<Request> {
  return { body: { sender, recipient } };
}

function makeRes(): { status: jest.Mock; json: jest.Mock; set: jest.Mock; _status: number } {
  const res = {
    _status: 200,
    set: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

const BASE_CFG: RateLimitConfig = {
  senderWindowMs: 60_000,
  senderMax: 100,
  convWindowMs: 60_000,
  convMax: 5,
};

describe("per-conversation rate limit (#1650)", () => {
  it("allows messages within the conversation limit", () => {
    // Fresh config with unique sender/recipient to avoid state bleed
    const middleware = buildRateLimitMiddleware({ ...BASE_CFG, convMax: 3 });
    const sender = `SENDER_CONV_OK_${Date.now()}`;
    const recipient = `RECV_CONV_OK_${Date.now()}`;

    for (let i = 0; i < 3; i++) {
      const next = jest.fn();
      const req = makeReq(sender, recipient);
      const res = makeRes();
      middleware(req as Request, res as unknown as Response, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it("rejects the message that exceeds the conversation limit with RATE_LIMIT_CONVERSATION", () => {
    const middleware = buildRateLimitMiddleware({ ...BASE_CFG, convMax: 2 });
    const sender = `SENDER_CONV_OVER_${Date.now()}`;
    const recipient = `RECV_CONV_OVER_${Date.now()}`;

    // Consume both allowed slots
    for (let i = 0; i < 2; i++) {
      const next = jest.fn();
      middleware(makeReq(sender, recipient) as Request, makeRes() as unknown as Response, next);
    }

    // Third message should be rejected
    const next = jest.fn();
    const res = makeRes();
    middleware(makeReq(sender, recipient) as Request, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe("RATE_LIMIT_CONVERSATION");
  });

  it("different recipients get independent buckets", () => {
    const middleware = buildRateLimitMiddleware({ ...BASE_CFG, convMax: 1 });
    const sender = `SENDER_MULTI_${Date.now()}`;
    const next1 = jest.fn();
    const next2 = jest.fn();

    // Exhaust the limit to recipient A
    middleware(makeReq(sender, "RECV_A") as Request, makeRes() as unknown as Response, next1);
    middleware(makeReq(sender, "RECV_A") as Request, makeRes() as unknown as Response, jest.fn());

    // Recipient B should still be allowed
    const res2 = makeRes();
    middleware(makeReq(sender, "RECV_B") as Request, res2 as unknown as Response, next2);

    expect(next2).toHaveBeenCalled();
    expect(res2.status).not.toHaveBeenCalled();
  });

  it("rejects with RATE_LIMIT_SENDER when global sender limit is hit", () => {
    const middleware = buildRateLimitMiddleware({
      ...BASE_CFG,
      senderMax: 2,
      convMax: 100,
    });
    const sender = `SENDER_GLOBAL_${Date.now()}`;
    const recipient = `RECV_GLOBAL_${Date.now()}`;

    // Exhaust global limit
    for (let i = 0; i < 2; i++) {
      const next = jest.fn();
      middleware(makeReq(sender, recipient) as Request, makeRes() as unknown as Response, next);
    }

    const next = jest.fn();
    const res = makeRes();
    middleware(makeReq(sender, recipient) as Request, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json.mock.calls[0][0].code).toBe("RATE_LIMIT_SENDER");
  });

  it("calls next when no sender is present (validation delegated to route)", () => {
    const middleware = buildRateLimitMiddleware(BASE_CFG);
    const next = jest.fn();
    const req = { body: {} } as Request;
    middleware(req, makeRes() as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });
});
