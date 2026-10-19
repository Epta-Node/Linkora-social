-- Migration: Create post_scores materialized view
-- Description: Materialized view for weighted post scoring (recency + like_count + tip_total)
--
-- Scoring formula (weights are tunable):
-- - Base score: 100 points
-- - Likes: 5 points each
-- - Tips: normalized by dividing by 1,000,000 stroops (0.1 XLM per point)
-- - Recency decay: 1 point per hour since creation
--
-- Example: A post with 10 likes and 1 XLM tip (10,000,000 stroops) created 2 hours ago:
--   100 + (10 * 5) + (10000000 / 1000000) + (0 - 2) = 100 + 50 + 10 - 2 = 158

-- Create materialized view for post scores
CREATE MATERIALIZED VIEW IF NOT EXISTS post_scores AS
SELECT
    p.id,
    p.author,
    p.content,
    p.tip_total,
    p.like_count,
    p.created_at,
    -- Weighted score calculation:
    -- - Recency: posts lose 1 point per hour since creation
    -- - Likes: each like contributes 5 points
    -- - Tips: tip_total / 1,000,000 (stroops normalized to XLM scale)
    -- - Base score of 100 for all posts
    (
        100 +
        (p.like_count * 5) +
        (p.tip_total::numeric / 1000000) -
        EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600
    )::integer AS score,
    NOW() AS last_updated
FROM posts p
WHERE p.deleted_at IS NULL;

-- Create index on score for ordered queries
CREATE INDEX IF NOT EXISTS idx_post_scores_score ON post_scores (score DESC);

-- Create index on author for following feed queries
CREATE INDEX IF NOT EXISTS idx_post_scores_author ON post_scores (author, created_at DESC);

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_post_scores_id ON post_scores (id);
