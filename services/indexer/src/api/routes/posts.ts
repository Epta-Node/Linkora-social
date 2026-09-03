import { Router, Request, Response } from "express";
import express from "express";
import { randomUUID } from "node:crypto";
import { createWriteStream, promises as fsp } from "node:fs";
import { extname, join } from "node:path";
import { validateQuery, validateParams } from "../../middleware/validate";
import { z } from "zod";
import { cursorPaginationSchema, numericIdStringSchema } from "@linkora/types/src/schemas";
import { notFoundError, internalError } from "@linkora/types/src/errors";
import { MediaUploadConfig } from "../../config";
import { Database } from "../../db";

const listPostsQuerySchema = cursorPaginationSchema.extend({
  author: z.string().optional(),
});

const postIdParamsSchema = z.object({
  id: numericIdStringSchema,
});

export const DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const DEFAULT_MEDIA_UPLOAD_CONFIG: MediaUploadConfig = {
  maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
  allowedImageTypes: ["image/jpeg", "image/png", "image/webp"],
  uploadDir: "./uploads/media",
};

/**
 * Error raised when an incoming upload does not fit inside the configured
 * server byte budget. Carries the limit so callers can report it verbatim.
 */
class UploadTooLargeError extends Error {
  readonly requested: number;
  readonly limit: number;

  constructor(requested: number, limit: number) {
    super(`Upload exceeds the ${limit} byte limit`);
    this.requested = requested;
    this.limit = limit;
  }
}

/** Collect the raw multipart body, aborting as soon as it exceeds a hard cap. */
function readRawBody(req: Request, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let rejected = false;

    const fail = (err: Error) => {
      if (rejected) return;
      rejected = true;
      req.removeAllListeners("data");
      req.removeAllListeners("end");
      req.removeAllListeners("error");
      reject(err);
    };

    req.on("data", (chunk: Buffer) => {
      if (rejected) return;
      total += chunk.length;
      if (total > maxBytes) {
        // Do not keep reading — the body has already exceeded the budget, so
        // any file inside it would have to be truncated. Reject instead of
        // persisting a partial upload.
        fail(new UploadTooLargeError(total, maxBytes));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on("error", (err) => fail(err));
    req.on("close", () => {
      if (!rejected && !req.complete) {
        fail(new Error("Request aborted before the media upload completed"));
      }
    });
  });
}

function parseBoundary(contentType: string | undefined): string {
  if (!contentType) {
    throw new Error("Missing Content-Type header");
  }
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match || !(match[1] ?? match[2])) {
    throw new Error("Content-Type is not a valid multipart/form-data request");
  }
  return (match[1] ?? match[2]).trim();
}

interface ParsedFilePart {
  fieldName: string;
  filename: string | undefined;
  contentType: string | undefined;
  content: Buffer;
}

/**
 * Minimal single-file multipart/form-data parser.
 *
 * Parses a whole request body that has already been capped at the upload
 * budget, extracts the single file field, and verifies that the file's own
 * content also stays under the limit. Not a general-purpose parser — it is
 * deliberately restricted to the shape produced by the web composer.
 */
function parseMultipartFile(body: Buffer, boundary: string): ParsedFilePart {
  const delimiter = Buffer.from(`--${boundary}`);
  const frames = splitBuffer(body, delimiter).filter((part) => part.length > 0);

  let filePart: ParsedFilePart | undefined;

  for (const frame of frames) {
    // Each frame ends with a trailing CRLF (or `--` for the closing boundary).
    const trimmed = frame.subarray(0, frame.length - 2);

    const headerEnd = trimmed.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) continue;

    const headerBuf = trimmed.subarray(0, headerEnd);
    const content = trimmed.subarray(headerEnd + 4);

    const headers = headerBuf.toString("utf8");
    const disposition = /content-disposition:\s*([^\r\n]+)/i.exec(headers)?.[1] ?? "";
    const fieldName = /name="([^"]*)"/i.exec(disposition)?.[1];
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1];
    const contentType = /^content-type:\s*([^\r\n]+)/im.exec(headers)?.[1]?.trim();

    if (!fieldName) continue;

    if (filename !== undefined) {
      filePart = { fieldName, filename, contentType, content };
      break;
    }
  }

  if (!filePart) {
    throw new Error("No file field found in the multipart request");
  }

  return filePart;
}

function splitBuffer(buf: Buffer, delimiter: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let index = buf.indexOf(delimiter);
  let from = 0;
  while (index !== -1) {
    parts.push(buf.subarray(from, index));
    from = index + delimiter.length;
    index = buf.indexOf(delimiter, from);
  }
  parts.push(buf.subarray(from));
  return parts;
}

function respondError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown
): void {
  res.status(statusCode).json({
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      ...(res.req.context?.requestId ? { requestId: res.req.context.requestId } : {}),
    },
  });
}

export function createPostsRouter(
  db: Database,
  mediaUpload: MediaUploadConfig = DEFAULT_MEDIA_UPLOAD_CONFIG
): Router {
  const router = Router();

  // Report the server's upload budget so the client can reject oversized files
  // before the transfer starts. Registered ahead of `/:id` so it is never
  // mistaken for a post id.
  router.get("/media/config", (_req: Request, res: Response): void => {
    res.json({
      max_upload_bytes: mediaUpload.maxUploadBytes,
      allowed_image_types: mediaUpload.allowedImageTypes,
    });
  });

  router.post("/media", async (req: Request, res: Response): Promise<void> => {
    // Allow a little slack above the file budget for multipart framing so a
    // clean 413 is returned for the file, not for the wrapper bytes.
    const bodyBudget = mediaUpload.maxUploadBytes + 8 * 1024;

    let rawBody: Buffer;
    try {
      rawBody = await readRawBody(req, bodyBudget);
    } catch (error) {
      if (error instanceof UploadTooLargeError) {
        respondError(
          res,
          413,
          "PAYLOAD_TOO_LARGE",
          `Upload exceeds the maximum size of ${mediaUpload.maxUploadBytes} bytes.`,
          { max_upload_bytes: mediaUpload.maxUploadBytes }
        );
        return;
      }
      respondError(res, 400, "UPLOAD_ABORTED", "The upload was interrupted before it completed.");
      return;
    }

    let file: ParsedFilePart;
    try {
      const boundary = parseBoundary(req.headers["content-type"]);
      file = parseMultipartFile(rawBody, boundary);
    } catch (error) {
      respondError(res, 400, "INVALID_UPLOAD", (error as Error).message);
      return;
    }

    if (!file.contentType || !mediaUpload.allowedImageTypes.includes(file.contentType)) {
      respondError(
        res,
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        `Unsupported file type (${file.contentType ?? "unknown"}). Accepted formats: ${mediaUpload.allowedImageTypes.join(", ")}.`
      );
      return;
    }

    if (file.content.length > mediaUpload.maxUploadBytes) {
      respondError(
        res,
        413,
        "PAYLOAD_TOO_LARGE",
        `File size exceeds the maximum of ${mediaUpload.maxUploadBytes} bytes.`,
        {
          max_upload_bytes: mediaUpload.maxUploadBytes,
          actual_size: file.content.length,
        }
      );
      return;
    }

    const ext = extname(file.filename ?? "").toLowerCase();
    const filename = `${randomUUID()}${ext || ".img"}`;
    const fullPath = join(mediaUpload.uploadDir, filename);

    try {
      await fsp.mkdir(mediaUpload.uploadDir, { recursive: true });
      await new Promise<void>((resolve, reject) => {
        const stream = createWriteStream(fullPath);
        stream.on("error", reject);
        stream.on("finish", resolve);
        stream.end(file.content);
      });
    } catch (error) {
      console.error("Failed to persist media upload:", error);
      const err = internalError("Failed to persist media upload");
      res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
      return;
    }

    res.status(201).json({
      url: `/api/posts/media/${filename}`,
      size: file.content.length,
    });
  });

  // Serve previously uploaded media. Registered after the config + upload
  // handlers so `GET /media/config` wins over static file resolution.
  router.use("/media", express.static(mediaUpload.uploadDir, { index: false }));

  router.get(
    "/",
    validateQuery(listPostsQuerySchema),
    async (req: Request, res: Response): Promise<void> => {
      const { author, limit, cursor } = req.query as unknown as z.infer<
        typeof listPostsQuerySchema
      >;

      const { posts, total, hasMore } = await db.listPostsCursor({
        author: author || undefined,
        limit,
        cursor: cursor || undefined,
      });
      res.json({
        posts,
        total,
        limit,
        cursor: cursor ?? null,
        has_more: hasMore,
      });
    }
  );

  router.get(
    "/:id",
    validateParams(postIdParamsSchema),
    async (req: Request, res: Response): Promise<void> => {
      const postId = BigInt(req.params.id);
      const post = await db.getPost(postId);
      if (!post) {
        const err = notFoundError("Post not found");
        res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
        return;
      }
      res.json(post);
    }
  );

  router.get(
    "/:id/reports",
    validateParams(postIdParamsSchema),
    async (req: Request, res: Response): Promise<void> => {
      const postId = BigInt(req.params.id);

      try {
        const reports = await db.getPostReports(postId);
        res.json({
          post_id: postId.toString(),
          reports,
          total: reports.length,
        });
      } catch (error) {
        console.error(`Error fetching reports for post ${postId}:`, error);
        const err = internalError("Failed to fetch reports");
        res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
      }
    }
  );

  return router;
}
