-- Migration 013: Create follow_counts table and sync triggers

CREATE TABLE IF NOT EXISTS follow_counts (
    user_address TEXT PRIMARY KEY,
    followers_count INTEGER NOT NULL DEFAULT 0,
    following_count INTEGER NOT NULL DEFAULT 0
);

-- Trigger Function
CREATE OR REPLACE FUNCTION sync_follow_counts()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        -- Increment follower's following_count
        INSERT INTO follow_counts (user_address, following_count) 
        VALUES (NEW.follower, 1)
        ON CONFLICT (user_address) DO UPDATE SET following_count = follow_counts.following_count + 1;
        
        -- Increment followee's followers_count
        INSERT INTO follow_counts (user_address, followers_count) 
        VALUES (NEW.followee, 1)
        ON CONFLICT (user_address) DO UPDATE SET followers_count = follow_counts.followers_count + 1;
        
        RETURN NEW;
    ELSIF (TG_OP = 'DELETE') THEN
        -- Decrement follower's following_count
        UPDATE follow_counts SET following_count = following_count - 1 WHERE user_address = OLD.follower;
        
        -- Decrement followee's followers_count
        UPDATE follow_counts SET followers_count = followers_count - 1 WHERE user_address = OLD.followee;
        
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger (CREATE OR REPLACE is atomic and concurrency-safe; PG 14+ required,
-- which is satisfied by our postgres:16 baseline).
CREATE OR REPLACE TRIGGER update_follow_counts_trigger
AFTER INSERT OR DELETE ON follows
FOR EACH ROW EXECUTE FUNCTION sync_follow_counts();

-- Reconciliation is intentionally idempotent and can be run after a partial
-- transaction or profile deletion without relying on trigger history.
CREATE OR REPLACE FUNCTION reconcile_follow_counts()
RETURNS INTEGER AS $$
DECLARE drifted INTEGER;
BEGIN
        SELECT COUNT(*) INTO drifted
        FROM follow_counts c
        FULL OUTER JOIN (
            SELECT address AS user_address,
                         (SELECT COUNT(*) FROM follows WHERE follower = address)::int AS following_count,
                         (SELECT COUNT(*) FROM follows WHERE followee = address)::int AS followers_count
            FROM profiles
        ) e USING (user_address)
        WHERE COALESCE(c.followers_count, 0) <> COALESCE(e.followers_count, 0)
             OR COALESCE(c.following_count, 0) <> COALESCE(e.following_count, 0);

        INSERT INTO follow_counts (user_address, followers_count, following_count)
        SELECT address,
                     (SELECT COUNT(*) FROM follows WHERE followee = address),
                     (SELECT COUNT(*) FROM follows WHERE follower = address)
        FROM profiles
        ON CONFLICT (user_address) DO UPDATE SET
            followers_count = EXCLUDED.followers_count,
            following_count = EXCLUDED.following_count;
        RETURN drifted;
END;
$$ LANGUAGE plpgsql;
