-- Migration: Create post_scores materialized view
-- Description: Materialized view for weighted post scoring (recency + like_count + tip_total)

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
    -- - Recency: posts lose 1 point per hour since creation (exponential decay)
    -- - Likes: each like contributes 5 points
    -- - Tips: each tip unit contributes 1 point
    -- - Base score of 100 for all posts
    (
        100 + 
        (p.like_count * 5) + 
        (p.tip_total * 1) - 
        EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600
    ) AS score,
    NOW() AS last_updated
FROM posts p
WHERE p.deleted_at IS NULL;

-- Create index on score for ordered queries
CREATE INDEX IF NOT EXISTS idx_post_scores_score ON post_scores (score DESC);

-- Create index on author for following feed queries
CREATE INDEX IF NOT EXISTS idx_post_scores_author ON post_scores (author, created_at DESC);

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_post_scores_id ON post_scores (id);
