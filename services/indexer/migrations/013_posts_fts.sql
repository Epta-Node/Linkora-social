-- Migration: Add full-text search index to posts
-- Description: Adds a tsvector column on posts.content backed by a GIN index
--              so that ts_rank-ordered full-text search queries are efficient.

-- 1. Add the generated tsvector column (auto-maintained by PostgreSQL).
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS content_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

-- 2. Create the GIN index so ts_rank queries use an index scan.
CREATE INDEX IF NOT EXISTS idx_posts_content_fts
  ON posts USING GIN (content_tsv);
