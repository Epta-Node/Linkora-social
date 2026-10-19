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
 *
 * Success criteria: the request is only reported as successful when the
 * secrets backend supports runtime rotation (`keystore.supportsRotation`) AND
 * the resulting fingerprint differs from the previous one. Anything else is a
 * non-2xx — an endpoint that reports success while doing nothing is worse than
 * one that fails loudly, since an operator responding to a suspected key
 * compromise would conclude the compromised key is gone (#1541).
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

    // #1541 — the env-backed keystore re-reads process.env, which cannot change
    // in a running process. Reloading there is guaranteed to yield the same key,
    // so a 200 response would report a rotation that never happened while the
    // operator believes a compromised key has been replaced. Refuse instead.
    if (!deps.keystore.supportsRotation) {
      logger.error(
        { source: deps.keystore.source, oldFingerprint },
        "Key rotation refused: keystore backend cannot rotate"
      );
      res.status(400).json({
        error: {
          code: "ROTATION_UNSUPPORTED",
          message:
            "The env-backed keystore cannot be rotated at runtime: SECRETS must reference a file " +
            `(SECRETS=file:///path/to/oracle-key.hex) to support rotation. Current source: ${deps.keystore.source}`,
        },
      });
      return;
    }

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

      // Success criterion of this endpoint, stated explicitly: the key must
      // actually have changed. A backend that yields the same material (stale
      // mount, reverted secret) is a no-op rotation and must never be reported
      // as success (#1541).
      if (newFingerprint === oldFingerprint) {
        logger.error(
          { oldFingerprint, source: deps.keystore.source },
          "Key rotation produced an unchanged fingerprint — treating as failure"
        );
        res.status(409).json({
          error: {
            code: "ROTATION_NOOP",
            message:
              "Reload returned the same signing key: the fingerprint is unchanged, so nothing was " +
              "rotated. Ensure the secret backend actually holds new key material.",
          },
        });
        return;
      }

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
