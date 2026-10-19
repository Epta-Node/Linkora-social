CREATE TABLE IF NOT EXISTS sent_notifications (
  id              BIGSERIAL    PRIMARY KEY,
  event_id        BIGINT       NOT NULL REFERENCES raw_events(id) ON DELETE CASCADE,
  event_type      TEXT         NOT NULL,
  recipient       TEXT         NOT NULL,
  dispatch_key    TEXT         NOT NULL,
  dispatched_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (dispatch_key)
);

CREATE INDEX IF NOT EXISTS idx_sent_notifications_recipient
  ON sent_notifications (recipient, dispatched_at DESC);
