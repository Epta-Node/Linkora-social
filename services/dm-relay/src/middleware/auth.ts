import { NextFunction, Request, Response } from "express";
import { AuthService, AuthError } from "../auth";
import { SendMessageSchema } from "../validation";
import { ZodError } from "zod";
import { validationError, unauthorizedError, internalError } from "@linkora/types/src/errors";

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
