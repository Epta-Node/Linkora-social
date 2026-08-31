/**
 * Handlers for User-related contract events (block, unblock, dm_key_published).
 */

import { Database } from "../db";

export interface BlockEvent {
  blocker: string;
  blocked: string;
}

export interface UnblockEvent {
  blocker: string;
  blocked: string;
}

export interface DmKeyPublishedEvent {
  address: string;
  x25519_pubkey: string;
}

/**
 * Handle Block event.
 * Inserts a block relation between blocker and blocked.
 * Idempotent.
 */
export async function handleBlock(
  source: Database | { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  event: BlockEvent
): Promise<void> {
  if (!event.blocker) {
    throw new Error("Block event missing required field: blocker");
  }
  if (!event.blocked) {
    throw new Error("Block event missing required field: blocked");
  }

  if ("query" in source) {
    await source.query(
      `
      INSERT INTO blocks (blocker, blocked)
      VALUES ($1, $2)
      ON CONFLICT (blocker, blocked) DO NOTHING
      `,
      [event.blocker, event.blocked]
    );
  } else {
    await source.insertBlock({
      blocker: event.blocker,
      blocked: event.blocked,
    });
  }
}

/**
 * Handle Unblock event.
 * Removes the block relation between blocker and blocked.
 * Idempotent.
 */
export async function handleUnblock(
  source: Database | { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  event: UnblockEvent
): Promise<void> {
  if (!event.blocker) {
    throw new Error("Unblock event missing required field: blocker");
  }
  if (!event.blocked) {
    throw new Error("Unblock event missing required field: blocked");
  }

  if ("query" in source) {
    await source.query(
      `
      DELETE FROM blocks
      WHERE blocker = $1 AND blocked = $2
      `,
      [event.blocker, event.blocked]
    );
  } else {
    await source.deleteBlock(event.blocker, event.blocked);
  }
}

/**
 * Handle DmKeyPublished event.
 * Upserts the dm_keys table mapping address to x25519 public key.
 * Idempotent.
 */
export async function handleDmKeyPublished(
  source: Database | { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  event: DmKeyPublishedEvent
): Promise<void> {
  if (!event.address) {
    throw new Error("DmKeyPublished event missing required field: address");
  }
  if (!event.x25519_pubkey) {
    throw new Error("DmKeyPublished event missing required field: x25519_pubkey");
  }

  if ("query" in source) {
    await source.query(
      `
      INSERT INTO dm_keys (address, x25519_pubkey, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (address)
      DO UPDATE SET
        x25519_pubkey = EXCLUDED.x25519_pubkey,
        updated_at = EXCLUDED.updated_at
      `,
      [event.address, event.x25519_pubkey]
    );
  } else {
    await source.upsertDmKey({
      address: event.address,
      x25519_pubkey: event.x25519_pubkey,
    });
  }
}
