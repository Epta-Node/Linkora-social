/**
 * POST /admin/rotate-key must never report success when no rotation happened
 * (#1541).
 *
 * The env-backed keystore re-reads `process.env`, which cannot change in a
 * running process, so rotation there is a silent no-op: the endpoint returned
 * 200 with an unchanged fingerprint and performed no cache invalidation, while
 * the operator concluded a suspected key compromise had been remediated.
 */

import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { jest } from "@jest/globals";
import { createAdminRouter } from "../routes/admin.js";
import { createKeystore } from "../secrets.js";
import { Signer } from "../signer.js";

jest.mock("../logger.js", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const SECRET = "admin-secret-token";
const SEED_HEX = "11".repeat(32);
const OTHER_SEED_HEX = "22".repeat(32);

interface Json {
  [key: string]: unknown;
}

function post(
  server: http.Server,
  path: string,
  token: string
): Promise<{ status: number; body: Json }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      {
        host: "127.0.0.1",
        port: addr.port,
        path,
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => {
          raw += chunk.toString();
        });
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: (raw ? JSON.parse(raw) : {}) as Json })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function startServer(deps: Parameters<typeof createAdminRouter>[0]) {
  const app = express();
  app.use("/admin", createAdminRouter(deps));
  const server = app.listen(0);
  const close = (): Promise<void> =>
    new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  return { server, close };
}

const saved = { ...process.env };

beforeEach(() => {
  process.env["ADMIN_SECRET"] = SECRET;
  delete process.env["SECRETS"];
});

afterEach(() => {
  process.env = { ...saved };
});

describe("POST /admin/rotate-key — env keystore", () => {
  it("returns a non-2xx status naming the SECRETS=file:// requirement", async () => {
    process.env["ORACLE_PRIVATE_KEY_HEX"] = SEED_HEX;
    const keystore = createKeystore();
    expect(keystore.supportsRotation).toBe(false);

    const signer = new Signer(keystore.loadSeed());
    const invalidateCache = jest.fn();
    const { server, close } = startServer({
      signer,
      keystore,
      invalidateCache,
      isReady: () => true,
    });

    try {
      const res = await post(server, "/admin/rotate-key", SECRET);

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).not.toBe(200);
      const error = res.body.error as { code: string; message: string } | undefined;
      expect(error?.code).toBe("ROTATION_UNSUPPORTED");
      expect(error?.message).toMatch(/SECRETS=file:\/\//);

      // Nothing was rotated, so nothing may be invalidated.
      expect(invalidateCache).not.toHaveBeenCalled();
    } finally {
      await close();
      signer.dispose();
    }
  });

  it("does not report success when the fingerprint is unchanged (file backend with stale secret)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oracle-key-"));
    const keyPath = join(dir, "oracle-key.hex");
    writeFileSync(keyPath, SEED_HEX, "utf8");

    try {
      process.env["SECRETS"] = `file://${keyPath}`;
      const keystore = createKeystore();
      expect(keystore.supportsRotation).toBe(true);

      const signer = new Signer(keystore.loadSeed());
      const invalidateCache = jest.fn();
      const { server, close } = startServer({
        signer,
        keystore,
        invalidateCache,
        isReady: () => true,
      });

      try {
        // The secret file still holds the ORIGINAL key, so reload() returns the
        // same material and the fingerprint is unchanged.
        const res = await post(server, "/admin/rotate-key", SECRET);

        expect(res.status).toBe(409);
        const error = res.body.error as { code: string } | undefined;
        expect(error?.code).toBe("ROTATION_NOOP");
        expect(invalidateCache).not.toHaveBeenCalled();
      } finally {
        await close();
        signer.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rotates successfully when the file backend yields new key material", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oracle-key-"));
    const keyPath = join(dir, "oracle-key.hex");
    writeFileSync(keyPath, SEED_HEX, "utf8");

    try {
      process.env["SECRETS"] = `file://${keyPath}`;
      const keystore = createKeystore();
      const signer = new Signer(keystore.loadSeed());
      const invalidateCache = jest.fn();
      const { server, close } = startServer({
        signer,
        keystore,
        invalidateCache,
        isReady: () => true,
      });

      try {
        // Operator rotates the secret out of band.
        writeFileSync(keyPath, OTHER_SEED_HEX, "utf8");

        const res = await post(server, "/admin/rotate-key", SECRET);

        expect(res.status).toBe(200);
        const body = res.body as unknown as { oldFingerprint: string; newFingerprint: string };
        expect(body.newFingerprint).not.toBe(body.oldFingerprint);
        expect(invalidateCache).toHaveBeenCalledWith(body.newFingerprint);
      } finally {
        await close();
        signer.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
