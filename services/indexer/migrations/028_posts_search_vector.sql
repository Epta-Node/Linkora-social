-- Migration 028: Add search_vector and full-text search index to posts
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_posts_search_vector ON posts USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_posts_content_trgm ON posts USING GIN (content gin_trgm_ops);
