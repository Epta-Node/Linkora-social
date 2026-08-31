/**
 * Post Event Handlers
 * Handles PostCreatedEvent and PostDeletedEvent from the Linkora contract
 */

import { Pool } from "pg";

export interface PostCreatedEvent {
  id: bigint;
  author: string;
}

export interface PostDeletedEvent {
  post_id: bigint;
  author: string;
}

export interface PostEventContext {
  txHash: string;
  ledgerSeq: number;
  timestamp: Date;
  content?: string; // Fetched from contract state if needed
}

/**
 * Handle PostCreatedEvent
 * Inserts a new post row into the posts table
 * Idempotent: Uses ON CONFLICT DO NOTHING to handle duplicate events
 */
export async function handlePostCreated(
  pool: Pool,
  event: PostCreatedEvent,
  context: PostEventContext
): Promise<void> {
  const { id, author } = event;
  const { timestamp, content } = context;

  // Use content from event context
  const postContent = content || "";

  const query = `
    INSERT INTO posts (id, author, content, tip_total, like_count, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO NOTHING
  `;

  const values = [
    id.toString(),
    author,
    postContent,
    0, // Initial tip_total
    0, // Initial like_count
    timestamp,
  ];

  try {
    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      console.log(`Post ${id} already exists (idempotent skip)`);
    } else {
      console.log(`Post ${id} created by ${author}`);
    }
  } catch (error) {
    console.error(`Error handling PostCreatedEvent for post ${id}:`, error);
    throw error;
  }
}

/**
 * Handle PostDeletedEvent
 * Marks a post as deleted (soft delete) by setting deleted_at timestamp
 * Idempotent: Only updates if deleted_at is NULL
 */
export async function handlePostDeleted(
  pool: Pool,
  event: PostDeletedEvent,
  context: PostEventContext
): Promise<void> {
  const { post_id, author } = event;
  const { timestamp } = context;

  const query = `
    UPDATE posts
    SET deleted_at = $1
    WHERE id = $2 AND author = $3 AND deleted_at IS NULL
  `;

  const values = [timestamp, post_id.toString(), author];

  try {
    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      console.log(`Post ${post_id} already deleted or not found (idempotent skip)`);
    } else {
      console.log(`Post ${post_id} deleted by ${author}`);
    }
  } catch (error) {
    console.error(`Error handling PostDeletedEvent for post ${post_id}:`, error);
    throw error;
  }
}

export async function getFeedPosts(
  pool: Pool,
  options: { viewerAddress?: string; limit: number; offset: number }
): Promise<any[]> {
  const { viewerAddress, limit, offset } = options;
  if (!viewerAddress) {
    const res = await pool.query(
      `
      SELECT p.*
      FROM posts p
      WHERE p.deleted_at IS NULL
      ORDER BY p.created_at DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );
    return res.rows;
  }

  const res = await pool.query(
    `
    SELECT p.*
    FROM posts p
    LEFT JOIN blocks b ON b.blocker = $1 AND b.blocked = p.author
    WHERE p.deleted_at IS NULL
      AND b.blocked IS NULL
    ORDER BY p.created_at DESC
    LIMIT $2 OFFSET $3
    `,
    [viewerAddress, limit, offset]
  );
  return res.rows;
}

/**
 * Unit test helper: Mock event data
 */
export function createMockPostCreatedEvent(
  id: bigint = 1n,
  author: string = "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
): { event: PostCreatedEvent; context: PostEventContext } {
  return {
    event: { id, author },
    context: {
      txHash: "0x1234567890abcdef",
      ledgerSeq: 12345,
      timestamp: new Date(),
      content: "Test post content",
    },
  };
}

export function createMockPostDeletedEvent(
  post_id: bigint = 1n,
  author: string = "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
): { event: PostDeletedEvent; context: PostEventContext } {
  return {
    event: { post_id, author },
    context: {
      txHash: "0xabcdef1234567890",
      ledgerSeq: 12346,
      timestamp: new Date(),
    },
  };
}
