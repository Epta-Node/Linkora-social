import { buildRateLimitMiddleware, RateLimitConfig } from "../middleware/rateLimit";
import { Request, Response } from "express";

const cfg: RateLimitConfig = { senderWindowMs: 60000, senderMax: 100, convWindowMs: 60000, convMax: 5 };

const makeReq = (sender: string, recipient: string) => ({ body: { sender, recipient } } as Request);
const makeRes = () => { const r = { set: jest.fn(), status: jest.fn(), json: jest.fn() }; r.status.mockReturnValue(r); return r; };

describe("per-conversation rate limit (#1650)", () => {
  it("burst within limit passes", () => {
    const mw = buildRateLimitMiddleware({ ...cfg, convMax: 3 });
    const s = `S_OK_${Date.now()}`, r = `R_OK_${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      const next = jest.fn();
      mw(makeReq(s, r), makeRes() as unknown as Response, next);
      expect(next).toHaveBeenCalled();
    }
  });

  it("over limit returns 429 RATE_LIMIT_CONVERSATION", () => {
    const mw = buildRateLimitMiddleware({ ...cfg, convMax: 2 });
    const s = `S_OV_${Date.now()}`, r = `R_OV_${Date.now()}`;
    mw(makeReq(s, r), makeRes() as unknown as Response, jest.fn());
    mw(makeReq(s, r), makeRes() as unknown as Response, jest.fn());
    const next = jest.fn(); const res = makeRes();
    mw(makeReq(s, r), res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json.mock.calls[0][0].code).toBe("RATE_LIMIT_CONVERSATION");
  });

  it("different recipients get independent buckets", () => {
    const mw = buildRateLimitMiddleware({ ...cfg, convMax: 1 });
    const s = `S_IND_${Date.now()}`;
    mw(makeReq(s, "R_A"), makeRes() as unknown as Response, jest.fn());
    mw(makeReq(s, "R_A"), makeRes() as unknown as Response, jest.fn());
    const next = jest.fn(); const res = makeRes();
    mw(makeReq(s, "R_B"), res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it("global sender limit returns RATE_LIMIT_SENDER", () => {
    const mw = buildRateLimitMiddleware({ ...cfg, senderMax: 2, convMax: 100 });
    const s = `S_GL_${Date.now()}`, r = `R_GL_${Date.now()}`;
    mw(makeReq(s, r), makeRes() as unknown as Response, jest.fn());
    mw(makeReq(s, r), makeRes() as unknown as Response, jest.fn());
    const next = jest.fn(); const res = makeRes();
    mw(makeReq(s, r), res as unknown as Response, next);
    expect(res.json.mock.calls[0][0].code).toBe("RATE_LIMIT_SENDER");
  });
});
