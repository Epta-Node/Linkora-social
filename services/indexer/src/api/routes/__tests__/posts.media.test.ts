import express from "express";
import request from "supertest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPostsRouter, DEFAULT_MEDIA_UPLOAD_CONFIG } from "../posts";
import { Database } from "../../../db";
import { MediaUploadConfig } from "../../../config";

const DB = {} as Database;

function buildApp(mediaUpload: MediaUploadConfig = DEFAULT_MEDIA_UPLOAD_CONFIG) {
  const app = express();
  app.use("/api/posts", createPostsRouter(DB, mediaUpload));
  return request(app);
}

function multipartBody(fieldName: string, filename: string, contentType: string, data: Buffer) {
  const boundary = "----linkoraTestBoundary";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([head, data, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe("posts media upload API", () => {
  describe("GET /api/posts/media/config", () => {
    it("reports the server's configured byte limit", async () => {
      const res = await buildApp().get("/api/posts/media/config");
      expect(res.status).toBe(200);
      expect(res.body.max_upload_bytes).toBe(DEFAULT_MEDIA_UPLOAD_CONFIG.maxUploadBytes);
      expect(res.body.allowed_image_types).toEqual(DEFAULT_MEDIA_UPLOAD_CONFIG.allowedImageTypes);
    });

    it("reflects an overridden limit", async () => {
      const res = await buildApp({ ...DEFAULT_MEDIA_UPLOAD_CONFIG, maxUploadBytes: 5 }).get(
        "/api/posts/media/config"
      );
      expect(res.body.max_upload_bytes).toBe(5);
    });
  });

  describe("POST /api/posts/media", () => {
    let uploadDir: string;

    beforeEach(async () => {
      uploadDir = await mkdtemp(join(tmpdir(), "linkora-media-"));
    });

    afterEach(async () => {
      await rm(uploadDir, { recursive: true, force: true });
    });

    it("accepts an allowed image under the limit and returns a served URL", async () => {
      const cfg = { ...DEFAULT_MEDIA_UPLOAD_CONFIG, uploadDir };
      const { body: fileBody, contentType } = multipartBody(
        "file",
        "photo.png",
        "image/png",
        Buffer.from("fakepngdata")
      );

      const res = await buildApp(cfg)
        .post("/api/posts/media")
        .set("Content-Type", contentType)
        .send(fileBody);

      expect(res.status).toBe(201);
      expect(res.body.size).toBe("fakepngdata".length);
      expect(res.body.url).toMatch(/^\/api\/posts\/media\/[a-f0-9-]+\.png$/);
    });

    it("rejects a file that exceeds the server limit before persisting", async () => {
      const cfg = { ...DEFAULT_MEDIA_UPLOAD_CONFIG, uploadDir, maxUploadBytes: 4 };
      const { body: fileBody, contentType } = multipartBody(
        "file",
        "big.png",
        "image/png",
        Buffer.from("abcdefghij")
      );

      const res = await buildApp(cfg)
        .post("/api/posts/media")
        .set("Content-Type", contentType)
        .send(fileBody);

      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
      expect(res.body.error.details.max_upload_bytes).toBe(4);
    });

    it("rejects an unsupported media type with 415", async () => {
      const cfg = { ...DEFAULT_MEDIA_UPLOAD_CONFIG, uploadDir };
      const { body: fileBody, contentType } = multipartBody(
        "file",
        "movie.mp4",
        "video/mp4",
        Buffer.from("fakevideo")
      );

      const res = await buildApp(cfg)
        .post("/api/posts/media")
        .set("Content-Type", contentType)
        .send(fileBody);

      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    });

    it("returns 201 for an upload sized exactly at the limit", async () => {
      const cfg = { ...DEFAULT_MEDIA_UPLOAD_CONFIG, uploadDir, maxUploadBytes: 10 };
      const { body: fileBody, contentType } = multipartBody(
        "file",
        "exact.png",
        "image/png",
        Buffer.from("1234567890")
      );

      const res = await buildApp(cfg)
        .post("/api/posts/media")
        .set("Content-Type", contentType)
        .send(fileBody);

      expect(res.status).toBe(201);
    });
  });
});
