-- Migration 022: notification inbox read watermark (issue #1632)
--
-- The inbox itself is derived from the domain tables (follows, likes, tips).
-- "Mark all as read" moves the recipient's watermark: every inbox item at or
-- before `read_through` is reported as read. Reading a single item is tracked
-- by the client, so it does not require a signed request per click.

CREATE TABLE IF NOT EXISTS notification_read_state (
    address      TEXT        PRIMARY KEY,
    read_through TIMESTAMPTZ NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
