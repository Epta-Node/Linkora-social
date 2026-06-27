-- Migration: Create feed ranking view
-- Description: Materialized view for Explore feed ordering

CREATE MATERIALIZED VIEW IF NOT EXISTS post_scores AS
SELECT 
    id as post_id,
    (EXTRACT(EPOCH FROM created_at) + (like_count * 10000) + (tip_total * 100)) as score
FROM posts
WHERE deleted_at IS NULL;

-- Indexes for fast querying
CREATE UNIQUE INDEX IF NOT EXISTS idx_post_scores_id ON post_scores (post_id);
CREATE INDEX IF NOT EXISTS idx_post_scores_score ON post_scores (score DESC);
