/**
 * Admin endpoints for the analytics oracle.
 *
 * POST /admin/rotate-key — reloads the signing key from the configured secrets
 * backend and atomically swaps the in-process signer. This enables zero-downtime
 * key rotation: the new public key is re-derived, the attestation cache is
 * invalidated, and every future signing happens under the new key.
 *
 * The endpoint is authenticated with a bearer token via the `ADMIN_SECRET`
 * environment variable. It must be set to a high-entropy random value and
 * injected via a secrets manager, never hard-coded.
 */

import { Router, Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import { logger } from "../logger.js";
import { Keystore } from "../secrets.js";
import { Signer } from "../signer.js";

export interface RotationResult {
  oldFingerprint: string;
  newFingerprint: string;
  source: string;
}

export interface AdminRouterDeps {
  signer: Signer;
  keystore: Keystore;
  /** Invalidate the attestation cache when the signing key changes. */
  invalidateCache: (fingerprint: string) => void;
  /** Whether the signer identity is published on-chain (used for audit). */
  isReady: () => boolean;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function createAdminRouter(deps: AdminRouterDeps): Router {
  const router = Router();

  router.post("/rotate-key", (req: Request, res: Response) => {
    const secret = process.env["ADMIN_SECRET"];
    if (!secret || secret.length === 0) {
      logger.error({ path: req.path }, "Admin route disabled: ADMIN_SECRET not set");
      res.status(500).json({
        error: { code: "ADMIN_DISABLED", message: "Admin routes are not configured" },
      });
      return;
    }

    const auth = req.header("authorization") ?? "";
    const [scheme, token] = auth.split(" ");
    if (scheme !== "Bearer" || !token || !safeEqual(token, secret)) {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
      return;
    }

    const oldFingerprint = deps.signer.fingerprint();
    let newSeed: Uint8Array;
    try {
      newSeed = deps.keystore.reload();
    } catch (err) {
      logger.error({ err }, "Key rotation failed to reload key");
      res.status(502).json({
        error: {
          code: "KEY_RELOAD_FAILED",
          message: "Failed to reload signing key from secrets backend",
        },
      });
      return;
    }

    try {
      const newFingerprint = deps.signer.rotate(newSeed);
      deps.invalidateCache(newFingerprint);
      deps.keystore.zeroise();

      const result: RotationResult = {
        oldFingerprint,
        newFingerprint,
        source: deps.keystore.source,
      };
      logger.info(
        {
          oldFingerprint,
          newFingerprint,
          source: deps.keystore.source,
          onChainReady: deps.isReady(),
        },
        "Oracle key rotation complete"
      );
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Key rotation failed to activate key");
      res.status(500).json({
        error: { code: "KEY_ROTATE_FAILED", message: "Failed to activate new key" },
      });
    }
  });

  return router;
}
