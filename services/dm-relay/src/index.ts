import express from "express";
import { Pool } from "pg";
import { buildRateLimitMiddleware } from "./middleware/rateLimit";
import { startPurgeJob } from "./jobs/purgeTtl";

const PORT = parseInt(process.env.PORT ?? "4000", 10);
const DATABASE_URL = process.env.DATABASE_URL ?? "";

const SENDER_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000", 10);
const SENDER_MAX = parseInt(process.env.RATE_LIMIT_MAX ?? "60", 10);
const CONV_WINDOW_MS = parseInt(process.env.CONV_RATE_LIMIT_WINDOW_MS ?? "60000", 10);
const CONV_MAX = parseInt(process.env.CONV_RATE_LIMIT_MAX ?? "20", 10);
const TTL_SECONDS = parseInt(process.env.MESSAGE_TTL_SECONDS ?? "604800", 10);
const PURGE_INTERVAL_MS = parseInt(process.env.PURGE_INTERVAL_MS ?? "3600000", 10);

const db = new Pool({ connectionString: DATABASE_URL });

const app = express();
app.use(express.json());

const rateLimitMiddleware = buildRateLimitMiddleware({
  senderWindowMs: SENDER_WINDOW_MS,
  senderMax: SENDER_MAX,
  convWindowMs: CONV_WINDOW_MS,
  convMax: CONV_MAX,
});

// POST /messages — store an encrypted DM
app.post("/messages", rateLimitMiddleware, async (req, res) => {
  const { sender, recipient, ciphertext } = req.body as {
    sender?: string;
    recipient?: string;
    ciphertext?: string;
  };

  if (!sender || !recipient || !ciphertext) {
    res.status(400).json({ error: "sender, recipient, and ciphertext are required" });
    return;
  }

  try {
    const result = await db.query<{ id: string }>(
      "INSERT INTO messages (sender, recipient, ciphertext) VALUES ($1, $2, $3) RETURNING id",
      [sender, recipient, ciphertext]
    );
    res.status(201).json({ id: result.rows[0].id });
  } catch (err) {
    console.error("Failed to store message:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /health
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const cancel = startPurgeJob(db, TTL_SECONDS, PURGE_INTERVAL_MS);

const server = app.listen(PORT, () => {
  console.log(`dm-relay listening on port ${PORT}`);
});

process.on("SIGTERM", () => {
  cancel();
  server.close(() => process.exit(0));
});

export default app;
