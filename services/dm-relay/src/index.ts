import express from "express";
import { Pool } from "pg";
import { buildRateLimitMiddleware } from "./middleware/rateLimit";
import { startPurgeJob } from "./jobs/purgeTtl";

const db = new Pool({ connectionString: process.env.DATABASE_URL });
const app = express();
app.use(express.json());

app.use("/messages", buildRateLimitMiddleware({
  senderWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000", 10),
  senderMax:      parseInt(process.env.RATE_LIMIT_MAX ?? "60", 10),
  convWindowMs:   parseInt(process.env.CONV_RATE_LIMIT_WINDOW_MS ?? "60000", 10),
  convMax:        parseInt(process.env.CONV_RATE_LIMIT_MAX ?? "20", 10),
}));

app.post("/messages", async (req, res) => {
  const { sender, recipient, ciphertext } = req.body;
  if (!sender || !recipient || !ciphertext) { res.status(400).json({ error: "sender, recipient, ciphertext required" }); return; }
  const r = await db.query("INSERT INTO messages (sender,recipient,ciphertext) VALUES ($1,$2,$3) RETURNING id", [sender, recipient, ciphertext]);
  res.status(201).json({ id: r.rows[0].id });
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

const cancel = startPurgeJob(
  db,
  parseInt(process.env.MESSAGE_TTL_SECONDS ?? "604800", 10),
  parseInt(process.env.PURGE_INTERVAL_MS ?? "3600000", 10)
);

const server = app.listen(parseInt(process.env.PORT ?? "4000", 10));
process.on("SIGTERM", () => { cancel(); server.close(() => process.exit(0)); });
export default app;
