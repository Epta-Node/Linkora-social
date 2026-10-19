import { Request, Response, NextFunction } from "express";
import { z, ZodError } from "zod";
import { validationError } from "@linkora/types";
import { sanitizeObject, CONTROL_CHAR_REGEX } from "../codec.js";

type ValidationTarget = "body" | "query" | "params";

function formatZodError(error: ZodError) {
  return error.errors.map((e) => ({
    path: e.path.join("."),
    message: e.message,
  }));
}

/**
 * Recursively walk a request target and reject any string value that
 * contains control characters (U+0000–U+001F, U+007F, U+0080–U+009F).
 * Strings are also trimmed.
 */
function containsControlChars(value: unknown): string | null {
  if (typeof value === "string") {
    return CONTROL_CHAR_REGEX.test(value) ? value : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = containsControlChars(item);
      if (found !== null) return found;
    }
  }
  if (value !== null && typeof value === "object") {
    for (const val of Object.values(value as Record<string, unknown>)) {
      const found = containsControlChars(val);
      if (found !== null) return found;
    }
  }
  return null;
}

export function validate(schema: z.ZodType, target: ValidationTarget) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      const err = validationError("Invalid request data", formatZodError(result.error));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      res.status(err.statusCode).json(err.toJSON((req as any).requestId));
      return;
    }

    // Reject request data that contains control characters before sanitising.
    const controlCharViolation = containsControlChars(result.data);
    if (controlCharViolation !== null) {
      const err = validationError(
        "Request data contains unauthorised control characters",
        [{ path: target, message: `Control characters detected in ${target}` }]
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      res.status(err.statusCode).json(err.toJSON((req as any).requestId));
      return;
    }

    // Sanitise: trim whitespace from all string fields.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any)[target] = sanitizeObject(result.data);
    next();
  };
}

export const validateBody = (schema: z.ZodType) => validate(schema, "body");
export const validateQuery = (schema: z.ZodType) => validate(schema, "query");
export const validateParams = (schema: z.ZodType) => validate(schema, "params");
