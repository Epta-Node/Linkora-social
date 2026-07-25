import { rateLimit } from "express-rate-limit";
import { NextFunction, Request, Response } from "express";
import { rateLimitedError } from "@linkora/types/src/errors";

function getClientIP(req: Request): string {
  const xForwardedFor = req.headers["x-forwarded-for"];
  if (typeof xForwardedFor === "string") {
    return xForwardedFor.split(",")[0].trim();
  }
  return req.ip || "unknown";
}

const RATE_LIMIT_ANON_RPM = parseInt(process.env.RATE_LIMIT_ANON_RPM || "100", 10);
const RATE_LIMIT_AUTH_RPM = parseInt(process.env.RATE_LIMIT_AUTH_RPM || "300", 10);

export const anonLimiter = rateLimit({
  windowMs: 60_000,
  limit: RATE_LIMIT_ANON_RPM,
  keyGenerator: (req: Request) => getClientIP(req),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    const err = rateLimitedError(`Max ${RATE_LIMIT_ANON_RPM} requests per minute per IP`);
    res.status(err.statusCode).json(err.toJSON((_req as any).requestId));
  },
});

export const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: RATE_LIMIT_AUTH_RPM,
  keyGenerator: (req: Request) => (req as any).stellarAddress || getClientIP(req),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    const err = rateLimitedError(
      `Max ${RATE_LIMIT_AUTH_RPM} requests per minute per authenticated user`
    );
    res.status(err.statusCode).json(err.toJSON((_req as any).requestId));
  },
});

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  if ((req as any).stellarAddress) {
    return authLimiter(req, res, next);
  }
  return anonLimiter(req, res, next);
}
