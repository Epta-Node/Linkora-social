import { NextFunction, Request, Response } from "express";
import { AuthService, AuthError } from "../auth";
import { SendMessageSchema } from "../validation";
import { ZodError } from "zod";
import {
  validationError,
  unauthorizedError,
  forbiddenError,
  internalError,
} from "@linkora/types/src/errors";

export function messageAuthMiddleware(authService: AuthService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const messageData = SendMessageSchema.parse(req.body);

      authService.verifyMessageAuth({
        sender: messageData.sender,
        to: messageData.recipient,
        nonce: messageData.message_index,
        timestamp: messageData.timestamp,
        signature: messageData.signature,
      });

      (req as any).stellarAddress = messageData.sender;
      next();
    } catch (error) {
      const requestId = (req as any).requestId;

      if (error instanceof ZodError) {
        const err = validationError("Invalid request data", error.errors);
        res.status(err.statusCode).json(err.toJSON(requestId));
        return;
      }

      if (error instanceof AuthError) {
        const err = unauthorizedError(error.message);
        res.status(err.statusCode).json(err.toJSON(requestId));
        return;
      }

      const err = internalError("Authentication error");
      res.status(err.statusCode).json(err.toJSON(requestId));
    }
  };
}

/**
 * Middleware that verifies the caller owns the Stellar address via a signed
 * challenge in the Authorization header.
 *
 * Expected format: `Stellar <address> <signature> <timestamp>`
 *
 * On success, sets `req.stellarAddress` so downstream handlers and rate
 * limiters can use it. Returns 401 for missing/invalid auth and 403 when
 * the authenticated address does not match the requested :address param.
 */
export function addressOwnershipMiddleware(authService: AuthService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const { address, signature, timestamp } = AuthService.parseAuthHeader(
        req.headers.authorization
      );

      authService.verifyAddressOwnership(address, timestamp, signature);

      const requestedAddress = req.params.address;
      if (requestedAddress && address !== requestedAddress) {
        const err = forbiddenError("Authenticated address does not match the requested address");
        res.status(err.statusCode).json(err.toJSON((req as any).requestId));
        return;
      }

      (req as any).stellarAddress = address;
      next();
    } catch (error) {
      const requestId = (req as any).requestId;

      if (error instanceof AuthError) {
        const err = unauthorizedError(error.message);
        res.status(err.statusCode).json(err.toJSON(requestId));
        return;
      }

      const err = internalError("Address authentication error");
      res.status(err.statusCode).json(err.toJSON(requestId));
    }
  };
}
