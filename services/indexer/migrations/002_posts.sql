-- Migration: Create posts table
-- Description: Stores on-chain posts with soft delete support

CREATE TABLE IF NOT EXISTS posts (
    id BIGINT PRIMARY KEY,
    author TEXT NOT NULL,
    content TEXT NOT NULL,
    tip_total BIGINT NOT NULL DEFAULT 0,
    like_count BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL,
    deleted_at TIMESTAMP DEFAULT NULL
);

-- Indexes for common queries. PostgreSQL does not support inline INDEX
-- definitions inside CREATE TABLE, so they are declared as separate,
-- idempotent statements.
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts (author);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_deleted_at ON posts (deleted_at);

-- Index for active posts (not deleted)
CREATE INDEX IF NOT EXISTS idx_posts_active ON posts (created_at DESC) WHERE deleted_at IS NULL;
