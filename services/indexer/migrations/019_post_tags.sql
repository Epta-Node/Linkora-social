-- Migration: Add tags array to posts table
-- Description: Stores lowercase extracted hashtags for fast querying

ALTER TABLE posts ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- Index for efficient tag search
CREATE INDEX IF NOT EXISTS idx_posts_tags ON posts USING GIN (tags);

-- Recreate post_scores to include tags
DROP MATERIALIZED VIEW IF EXISTS post_scores;
CREATE MATERIALIZED VIEW post_scores AS
SELECT 
    p.id,
    p.author,
    p.content,
    p.tags,
    p.tip_total,
    p.like_count,
    p.created_at,
    (
        100 + 
        (p.like_count * 5) + 
        (p.tip_total::numeric / 1000000) - 
        EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600
    )::integer AS score,
    NOW() AS last_updated
FROM posts p
WHERE p.deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_post_scores_score ON post_scores (score DESC);
CREATE INDEX IF NOT EXISTS idx_post_scores_author ON post_scores (author, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_post_scores_id ON post_scores (id);
CREATE INDEX IF NOT EXISTS idx_post_scores_tags ON post_scores USING GIN (tags);
