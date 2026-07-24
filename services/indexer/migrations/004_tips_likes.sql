-- Migration: Create tips and likes tracking tables
-- Description: Stores individual tip and like events for idempotency and analytics

CREATE TABLE IF NOT EXISTS tips (
    id SERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES posts(id),
    tipper TEXT NOT NULL,
    amount BIGINT NOT NULL,
    fee BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    tx_hash TEXT NOT NULL UNIQUE
);

-- Indexes (declared separately; PostgreSQL has no inline INDEX in CREATE TABLE).
CREATE INDEX IF NOT EXISTS idx_tips_post_id ON tips (post_id);
CREATE INDEX IF NOT EXISTS idx_tips_tipper ON tips (tipper);
CREATE INDEX IF NOT EXISTS idx_tips_created_at ON tips (created_at DESC);

CREATE TABLE IF NOT EXISTS likes (
    id SERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES posts(id),
    user_address TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    tx_hash TEXT NOT NULL UNIQUE,

    -- Unique constraint: one like per user per post
    UNIQUE (post_id, user_address)
);

-- Indexes (declared separately; PostgreSQL has no inline INDEX in CREATE TABLE).
CREATE INDEX IF NOT EXISTS idx_likes_post_id ON likes (post_id);
CREATE INDEX IF NOT EXISTS idx_likes_user ON likes (user_address);
CREATE INDEX IF NOT EXISTS idx_likes_created_at ON likes (created_at DESC);
