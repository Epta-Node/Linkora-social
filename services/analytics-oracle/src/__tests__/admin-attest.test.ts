import http from "node:http";
import express from "express";
import { jest } from "@jest/globals";
import { createAdminRouter } from "../routes/admin.js";

const SECRET = "admin-secret-token";
const CREATOR = "GBZAZSCCXRMPB4XZLT5K6VYA2PFUIAMH3HLJTXUHPOIFAXDEQECAVXZF";

function post(
  server: http.Server,
  path: string,
  token: string,
  payload?: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const body = payload ? JSON.stringify(payload) : "";
    const req = http.request(
      {
        host: "127.0.0.1",
        port: addr.port,
        path,
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => (raw += chunk.toString()));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw || "{}") })
        );
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

function startServer(
  submitManualAttestation: (
    creator: string,
    windowStart: bigint,
    windowEnd: bigint
  ) => Promise<string>
) {
  const app = express();
  app.use(express.json());
  app.use(
    "/admin",
    createAdminRouter({
      signer: {} as never,
      keystore: {} as never,
      invalidateCache: jest.fn(),
      isReady: () => true,
      submitManualAttestation,
    })
  );
  const server = app.listen(0);
  const close = (): Promise<void> =>
    new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  return { server, close };
}

describe("POST /admin/attest", () => {
  const originalSecret = process.env["ADMIN_SECRET"];

  beforeEach(() => {
    process.env["ADMIN_SECRET"] = SECRET;
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env["ADMIN_SECRET"];
    else process.env["ADMIN_SECRET"] = originalSecret;
  });

  it("submits the requested creator window and returns the transaction hash", async () => {
    const submit = jest.fn(async () => "tx-hash-123");
    const { server, close } = startServer(submit);
    try {
      const res = await post(server, "/admin/attest", SECRET, {
        creator: CREATOR,
        windowStart: "100",
        windowEnd: "200",
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ txHash: "tx-hash-123" });
      expect(submit).toHaveBeenCalledWith(CREATOR, 100n, 200n);
    } finally {
      await close();
    }
  });

  it("requires admin authentication", async () => {
    const submit = jest.fn(async () => "tx-hash-123");
    const { server, close } = startServer(submit);
    try {
      const res = await post(server, "/admin/attest", "wrong-secret", {
        creator: CREATOR,
        windowStart: "100",
        windowEnd: "200",
      });

      expect(res.status).toBe(401);
      expect(submit).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});
