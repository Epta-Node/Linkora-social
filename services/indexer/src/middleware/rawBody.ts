import express, { RequestHandler } from "express";
import type { IncomingMessage, ServerResponse } from "http";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * The unparsed request body, captured before JSON parsing.
       *
       * Only set when a JSON body was actually read — a request without a body
       * (or without a JSON content type) leaves this undefined, and callers
       * must treat that as an empty body.
       */
      rawBody?: Buffer;
    }
  }
}

/**
 * body-parser `verify` callback that stashes the raw bytes on the request.
 *
 * Stellar auth signatures commit to a hash of the exact body bytes, so the
 * unparsed buffer has to survive JSON parsing — re-serialising `req.body`
 * would not reproduce the client's byte sequence.
 */
export function captureRawBody(req: IncomingMessage, _res: ServerResponse, buf: Buffer): void {
  (req as express.Request).rawBody = buf;
}

/**
 * `express.json()` with raw-body capture enabled.
 *
 * Use this instead of `express.json()` anywhere `requireStellarAuth` is mounted,
 * otherwise every signed request fails body-hash verification.
 */
export function jsonWithRawBody(): RequestHandler {
  return express.json({ verify: captureRawBody });
}
