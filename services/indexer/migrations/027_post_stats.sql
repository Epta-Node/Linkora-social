-- Migration: Create post_stats table and sync triggers
-- Description: Aggregate stats for posts (tip_count, tip_total, reaction_count) (issue #1961)

CREATE TABLE IF NOT EXISTS post_stats (
  post_id        BIGINT PRIMARY KEY REFERENCES posts(id),
  tip_count      INT NOT NULL DEFAULT 0,
  tip_total      BIGINT NOT NULL DEFAULT 0,
  reaction_count INT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_stats_tip_count ON post_stats (tip_count DESC);
CREATE INDEX IF NOT EXISTS idx_post_stats_reaction_count ON post_stats (reaction_count DESC);

-- Trigger function for tips
CREATE OR REPLACE FUNCTION sync_post_tip_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO post_stats (post_id, tip_count, tip_total, updated_at)
    VALUES (NEW.post_id, 1, NEW.amount, NOW())
    ON CONFLICT (post_id) DO UPDATE SET
      tip_count = post_stats.tip_count + 1,
      tip_total = post_stats.tip_total + NEW.amount,
      updated_at = NOW();
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER update_post_tip_stats_trigger
AFTER INSERT ON tips
FOR EACH ROW EXECUTE FUNCTION sync_post_tip_stats();

-- Trigger function for reactions/likes
CREATE OR REPLACE FUNCTION sync_post_reaction_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO post_stats (post_id, reaction_count, updated_at)
    VALUES (NEW.post_id, 1, NOW())
    ON CONFLICT (post_id) DO UPDATE SET
      reaction_count = post_stats.reaction_count + 1,
      updated_at = NOW();
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE post_stats
    SET reaction_count = GREATEST(0, post_stats.reaction_count - 1),
        updated_at = NOW()
    WHERE post_id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER update_post_reaction_stats_trigger
AFTER INSERT OR DELETE ON likes
FOR EACH ROW EXECUTE FUNCTION sync_post_reaction_stats();

-- Initial population for existing posts
INSERT INTO post_stats (post_id, tip_count, tip_total, reaction_count, updated_at)
SELECT
  p.id,
  COALESCE(COUNT(DISTINCT t.id), 0) AS tip_count,
  COALESCE(SUM(t.amount), 0) AS tip_total,
  COALESCE(COUNT(DISTINCT l.id), 0) AS reaction_count,
  NOW()
FROM posts p
LEFT JOIN tips t ON t.post_id = p.id
LEFT JOIN likes l ON l.post_id = p.id
GROUP BY p.id
ON CONFLICT (post_id) DO NOTHING;
