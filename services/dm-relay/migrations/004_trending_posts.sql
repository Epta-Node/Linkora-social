-- Migration: Create trending_posts table
-- Description: Store trending scores for posts (issue #1971)

CREATE TABLE IF NOT EXISTS trending_posts (
  post_id VARCHAR(64) PRIMARY KEY,
  score NUMERIC NOT NULL,
  computed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  tips_last_1h NUMERIC NOT NULL DEFAULT 0,
  reactions_last_1h NUMERIC NOT NULL DEFAULT 0,
  hours_since_post NUMERIC NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_trending_posts_score ON trending_posts (score DESC);
CREATE INDEX IF NOT EXISTS idx_trending_posts_computed ON trending_posts (computed_at DESC);
