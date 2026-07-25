import { Request, Response, NextFunction } from "express";
import { generateRequestId } from "./utils";
import { logger } from "./logger";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      userId?: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  req.requestId = generateRequestId();
  res.setHeader("X-Request-ID", req.requestId);
  next();
}

export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  logger.info(
    { requestId: req.requestId, method: req.method, path: req.path, ip: req.ip },
    "Incoming request"
  );

  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info(
      {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        ...(req.userId && { userId: req.userId }),
      },
      "Request completed"
    );
  });

  next();
}

export function errorHandler(error: Error, req: Request, res: Response, _next: NextFunction) {
  logger.error({ requestId: req.requestId, err: error }, "Unhandled error");

  const statusCode =
    typeof (error as any).statusCode === "number" ? (error as any).statusCode : 500;
  const code = (error as any).code || "INTERNAL_ERROR";
  const message = process.env.NODE_ENV === "development" ? error.message : "Internal server error";
  const details = (error as any).details;

  const body: Record<string, unknown> = {
    code,
    message,
  };
  if (details !== undefined) body.details = details;
  if (req.requestId) body.requestId = req.requestId;

  res.status(statusCode).json({ error: body });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `Route ${req.method} ${req.path} not found`,
      requestId: req.requestId,
    },
  });
}

export function validateContentType(req: Request, res: Response, next: NextFunction) {
  if (req.method === "POST") {
    if (!req.is("application/json")) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Content-Type must be application/json",
          requestId: req.requestId,
        },
      });
    }
  }
  next();
}
