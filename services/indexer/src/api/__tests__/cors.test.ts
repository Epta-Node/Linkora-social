import express from "express";
import request from "supertest";
import { corsMiddleware } from "../index";

describe("CORS allowed origins configuration", () => {
  const origEnv = process.env.CORS_ALLOWED_ORIGINS;
  const origAllowedOrigins = process.env.ALLOWED_ORIGINS;

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.CORS_ALLOWED_ORIGINS = origEnv;
    } else {
      delete process.env.CORS_ALLOWED_ORIGINS;
    }
    if (origAllowedOrigins !== undefined) {
      process.env.ALLOWED_ORIGINS = origAllowedOrigins;
    } else {
      delete process.env.ALLOWED_ORIGINS;
    }
  });

  const createApp = () => {
    const app = express();
    app.use(corsMiddleware);
    app.get("/test", (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  };

  it("defaults to wildcard '*' when CORS_ALLOWED_ORIGINS is not set", async () => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    delete process.env.ALLOWED_ORIGINS;

    const app = createApp();

    // Actual request
    const res = await request(app).get("/test").set("Origin", "https://example.com");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();

    // Preflight request
    const preflight = await request(app).options("/test").set("Origin", "https://example.com");

    expect(preflight.status).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("*");
    expect(preflight.headers["access-control-allow-methods"]).toBe(
      "GET, POST, PATCH, DELETE, OPTIONS"
    );
    expect(preflight.headers["access-control-allow-headers"]).toBe("Content-Type, Authorization");
  });

  it("allows requests from configured origins in CORS_ALLOWED_ORIGINS", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://linkora.social, https://app.linkora.social";

    const app = createApp();

    // Allowed origin
    const res = await request(app).get("/test").set("Origin", "https://app.linkora.social");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.linkora.social");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");

    // Allowed origin preflight
    const preflight = await request(app)
      .options("/test")
      .set("Origin", "https://app.linkora.social");

    expect(preflight.status).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("https://app.linkora.social");
    expect(preflight.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("rejects unauthorized origins when a specific list is configured", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://linkora.social, https://app.linkora.social";

    const app = createApp();

    // Disallowed origin actual request
    const res = await request(app).get("/test").set("Origin", "https://malicious-site.com");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();

    // Disallowed origin preflight
    const preflight = await request(app)
      .options("/test")
      .set("Origin", "https://malicious-site.com");

    expect(preflight.status).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
