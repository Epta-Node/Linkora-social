-- Migration: Create reports table for moderation tracking
-- Description: Stores post reports and moderation actions

CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES posts(id),
    reporter_address TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'action_taken')),
    moderator_address TEXT,
    moderator_notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes (declared separately; PostgreSQL has no inline INDEX in CREATE TABLE).
CREATE INDEX IF NOT EXISTS idx_reports_post_id ON reports (post_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports (reporter_address);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports (created_at DESC);

-- Trigger to auto-update updated_at timestamp. CREATE OR REPLACE keeps the
-- migration idempotent when re-applied.
CREATE OR REPLACE FUNCTION update_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER reports_updated_at_trigger
    BEFORE UPDATE ON reports
    FOR EACH ROW
    EXECUTE FUNCTION update_reports_updated_at();
