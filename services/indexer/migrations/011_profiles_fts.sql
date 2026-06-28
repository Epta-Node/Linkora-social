-- Migration: Add full-text search index to profiles
-- Description: Adds a generated tsvector column for profile discovery
--              and a GIN index to keep username/token search fast.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS profile_tsv tsvector
    GENERATED ALWAYS AS (
      to_tsvector(
        'english',
        coalesce(username, '') || ' ' || coalesce(creator_token, '')
      )
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_profiles_profile_tsv
  ON profiles USING GIN (profile_tsv);
