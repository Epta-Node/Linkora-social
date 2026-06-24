/**
 * SQLite schema for the local Linkora cache (`linkora.db`).
 *
 * The DDL lives here so it can be shared by the SQLite store and referenced by
 * tests/documentation without importing any native module.
 */

export const DATABASE_NAME = "linkora.db";

export const CREATE_POSTS_TABLE = `
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    author TEXT NOT NULL,
    content TEXT NOT NULL,
    tip_total TEXT NOT NULL DEFAULT '0',
    like_count INTEGER NOT NULL DEFAULT 0,
    timestamp INTEGER NOT NULL,
    synced_at INTEGER NOT NULL
  );
`;

export const CREATE_PENDING_POSTS_TABLE = `
  CREATE TABLE IF NOT EXISTS pending_posts (
    local_id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT
  );
`;

export const CREATE_FEED_CURSOR_TABLE = `
  CREATE TABLE IF NOT EXISTS feed_cursor (
    feed_type TEXT PRIMARY KEY,
    last_cursor TEXT,
    updated_at INTEGER NOT NULL
  );
`;

/** Index that keeps `getPage` ordered-by-timestamp scans cheap. */
export const CREATE_POSTS_TIMESTAMP_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_posts_timestamp ON posts (timestamp DESC);
`;

export const MIGRATIONS: string[] = [
  CREATE_POSTS_TABLE,
  CREATE_PENDING_POSTS_TABLE,
  CREATE_FEED_CURSOR_TABLE,
  CREATE_POSTS_TIMESTAMP_INDEX,
];
