export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export const ErrorStatusMap: Record<ErrorCode, number> = {
  [ErrorCodes.VALIDATION_ERROR]: 400,
  [ErrorCodes.NOT_FOUND]: 404,
  [ErrorCodes.UNAUTHORIZED]: 401,
  [ErrorCodes.FORBIDDEN]: 403,
  [ErrorCodes.CONFLICT]: 409,
  [ErrorCodes.RATE_LIMITED]: 429,
  [ErrorCodes.INTERNAL_ERROR]: 500,
  [ErrorCodes.SERVICE_UNAVAILABLE]: 503,
};

export interface ErrorResponseBody {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export interface ErrorResponse {
  error: ErrorResponseBody;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  toJSON(requestId?: string): ErrorResponse {
    const body: ErrorResponseBody = {
      code: this.code,
      message: this.message,
    };
    if (this.details !== undefined) body.details = this.details;
    if (requestId) body.requestId = requestId;
    return { error: body };
  }
}

export function validationError(message: string, details?: unknown): AppError {
  return new AppError(400, ErrorCodes.VALIDATION_ERROR, message, details);
}

export function notFoundError(message?: string): AppError {
  return new AppError(404, ErrorCodes.NOT_FOUND, message ?? "Resource not found");
}

export function unauthorizedError(message?: string): AppError {
  return new AppError(401, ErrorCodes.UNAUTHORIZED, message ?? "Unauthorized");
}

export function forbiddenError(message?: string): AppError {
  return new AppError(403, ErrorCodes.FORBIDDEN, message ?? "Forbidden");
}

export function conflictError(message?: string): AppError {
  return new AppError(409, ErrorCodes.CONFLICT, message ?? "Resource already exists");
}

export function rateLimitedError(message?: string): AppError {
  return new AppError(429, ErrorCodes.RATE_LIMITED, message ?? "Too many requests");
}

export function internalError(message?: string): AppError {
  return new AppError(500, ErrorCodes.INTERNAL_ERROR, message ?? "Internal server error");
}

export function serviceUnavailableError(message?: string): AppError {
  return new AppError(503, ErrorCodes.SERVICE_UNAVAILABLE, message ?? "Service unavailable");
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
