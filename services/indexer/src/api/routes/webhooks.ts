import { Router, Request, Response } from "express";
import { Database } from "../../db";
import { validateBody, validateParams } from "../../middleware/validate";
import { z } from "zod";
import crypto from "crypto";
import { Pool } from "pg";
import { rateLimitWrite } from "../../middleware/rateLimit";

const registerWebhookSchema = z.object({
  url: z.string().url("Must be a valid URL"),
  secret: z.string().min(1, "Secret is required"),
  event_types: z.array(z.string()).min(1, "At least one event type is required"),
});

const webhookIdParamsSchema = z.object({
  id: z.string().uuid("Invalid webhook ID"),
});

export function createWebhooksRouter(db: Database, pg: Pool): Router {
  const router = Router();

  router.post(
    "/",
    rateLimitWrite,
    validateBody(registerWebhookSchema),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { url, secret, event_types } = req.body as z.infer<typeof registerWebhookSchema>;

        const result = await pg.query(
          `INSERT INTO webhooks (url, secret, event_types, active)
           VALUES ($1, $2, $3, true)
           RETURNING id, url, event_types, active, created_at`,
          [url, secret, event_types]
        );

        res.status(201).json({
          webhook: {
            id: result.rows[0].id,
            url: result.rows[0].url,
            event_types: result.rows[0].event_types,
            active: result.rows[0].active,
            created_at: result.rows[0].created_at,
          },
        });
      } catch (error) {
        res.status(500).json({ error: "Failed to register webhook" });
      }
    }
  );

  router.delete(
    "/:id",
    validateParams(webhookIdParamsSchema),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { id } = req.params;
        await pg.query(
          `UPDATE webhooks SET active = false, updated_at = NOW() WHERE id = $1`,
          [id]
        );
        res.status(204).send();
      } catch (error) {
        res.status(500).json({ error: "Failed to deactivate webhook" });
      }
    }
  );

  router.get(
    "/:id/deliveries",
    validateParams(webhookIdParamsSchema),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { id } = req.params;
        const result = await pg.query(
          `SELECT id, webhook_id, event_type, payload, status, attempt_count,
                  response_code, response_body, next_retry_at, last_attempt_at, created_at
           FROM webhook_deliveries
           WHERE webhook_id = $1
           ORDER BY created_at DESC
           LIMIT 100`,
          [id]
        );
        res.json({
          deliveries: result.rows,
        });
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch deliveries" });
      }
    }
  );

  return router;
}

export function signWebhookPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export async function deliverWebhook(
  pg: Pool,
  webhook: { id: string; url: string; secret: string },
  eventType: string,
  payload: any
): Promise<void> {
  const payloadStr = JSON.stringify(payload);
  const signature = signWebhookPayload(payloadStr, webhook.secret);

  const deliveryRes = await pg.query(
    `INSERT INTO webhook_deliveries (webhook_id, event_type, payload, status, attempt_count)
     VALUES ($1, $2, $3, 'pending', 0)
     RETURNING id`,
    [webhook.id, eventType, payload]
  );

  const deliveryId = deliveryRes.rows[0].id;

  // Attempt delivery
  const attemptDelivery = async (attempt: number) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Linkora-Signature": signature,
          "X-Linkora-Event": eventType,
        },
        body: payloadStr,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        await pg.query(
          `UPDATE webhook_deliveries
           SET status = 'success', attempt_count = $1, response_code = $2,
               last_attempt_at = NOW()
           WHERE id = $3`,
          [attempt + 1, response.status, deliveryId]
        );
        return;
      }

      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      const backoffTimes = [30000, 300000, 1800000]; // 30s, 5m, 30m
      if (attempt < 2) {
        // Schedule retry
        const retryDelay = backoffTimes[attempt];
        await pg.query(
          `UPDATE webhook_deliveries
           SET status = 'failed', attempt_count = $1, response_code = $2,
               response_body = $3, last_attempt_at = NOW(),
               next_retry_at = NOW() + INTERVAL '1 millisecond' * $4
           WHERE id = $5`,
          [attempt + 1, (error as any)?.response?.status || null, String(error).substring(0, 1000), retryDelay, deliveryId]
        );
        setTimeout(() => attemptDelivery(attempt + 1), retryDelay);
      } else {
        await pg.query(
          `UPDATE webhook_deliveries
           SET status = 'failed', attempt_count = $1, response_code = $2,
               response_body = $3, last_attempt_at = NOW()
           WHERE id = $4`,
          [attempt + 1, (error as any)?.response?.status || null, String(error).substring(0, 1000), deliveryId]
        );
      }
    }
  };

  attemptDelivery(0);
}
