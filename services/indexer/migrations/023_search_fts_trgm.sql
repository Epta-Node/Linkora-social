-- Migration: Enhance full-text search with tsvector on profiles and trigram indexes
-- Description: Adds pg_trgm extension, bio to profiles, tsvector columns for profiles,
--              GIN indexes for full-text search, and trigram indexes for fuzzy matching.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add bio column to profiles if it doesn't exist
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '';

-- Add handle column as alias for username for compatibility (some code may expect 'handle')
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS handle TEXT;

-- Backfill handle from username where missing
UPDATE profiles SET handle = username WHERE handle IS NULL OR handle = '';

-- Add tsvector column to profiles (handle, bio)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS profile_tsv tsvector
    GENERATED ALWAYS AS (
      to_tsvector('english', coalesce(handle, '') || ' ' || coalesce(username, '') || ' ' || coalesce(bio, ''))
    ) STORED;

-- GIN index for full-text search on profiles
CREATE INDEX IF NOT EXISTS idx_profiles_profile_fts ON profiles USING GIN (profile_tsv);

-- Trigram index for fuzzy/prefix matching on handles/usernames
CREATE INDEX IF NOT EXISTS idx_profiles_handle_trgm ON profiles USING GIN (handle gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_username_trgm ON profiles USING GIN (username gin_trgm_ops);

-- Ensure posts.content_tsv exists (idempotent) - already added in migration 013
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS content_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_posts_content_fts ON posts USING GIN (content_tsv);
