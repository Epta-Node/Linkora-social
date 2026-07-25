-- Migration: Create follow_counts table and sync triggers

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

-- Trigger
CREATE TRIGGER update_follow_counts_trigger
AFTER INSERT OR DELETE ON follows
FOR EACH ROW EXECUTE FUNCTION sync_follow_counts();
