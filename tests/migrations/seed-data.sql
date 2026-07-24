-- Seed data for migration testing.
--
-- Inserted AFTER the forward migration pass and expected to survive a second
-- (idempotent) migration pass unchanged. Rows are written in FK-dependency
-- order: parents (profiles, posts, raw_events) before children (tips, likes,
-- reports, sent_notifications).
--
-- Uses fixed Stellar-style addresses and deterministic ids so the integrity
-- checks in test-migrations.sh can assert exact counts. A bulk generate_series
-- insert simulates a more realistic post volume while staying well within the
-- 60s CI budget.

BEGIN;

-- ── Profiles ────────────────────────────────────────────────────────────────
INSERT INTO profiles (address, username, creator_token, updated_ledger) VALUES
  ('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALICE', 'alice', '', 100),
  ('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABOB',  'bob',   '', 101),
  ('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAROL',  'carol', '', 102)
ON CONFLICT (address) DO NOTHING;

-- ── Follows ─────────────────────────────────────────────────────────────────
INSERT INTO follows (follower, followee, created_at) VALUES
  ('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABOB',  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALICE', 110),
  ('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAROL',  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALICE', 111)
ON CONFLICT (follower, followee) DO NOTHING;

-- ── Posts ───────────────────────────────────────────────────────────────────
INSERT INTO posts (id, author, content, tip_total, like_count, created_at) VALUES
  (1, 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALICE', 'hello world from alice', 1000, 2, NOW() - INTERVAL '2 hours'),
  (2, 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABOB',  'bob posts about postgres', 0, 1, NOW() - INTERVAL '1 hour')
ON CONFLICT (id) DO NOTHING;

-- Bulk volume: 1000 additional posts authored by carol.
INSERT INTO posts (id, author, content, tip_total, like_count, created_at)
SELECT
  g,
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAROL',
  'bulk post #' || g,
  0,
  0,
  NOW() - (g || ' minutes')::INTERVAL
FROM generate_series(1000, 1999) AS g
ON CONFLICT (id) DO NOTHING;

-- ── Tips ────────────────────────────────────────────────────────────────────
INSERT INTO tips (post_id, tipper, amount, fee, created_at, tx_hash) VALUES
  (1, 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABOB', 1000, 10, NOW() - INTERVAL '90 minutes', 'txhash-tip-0001')
ON CONFLICT (tx_hash) DO NOTHING;

-- ── Likes ───────────────────────────────────────────────────────────────────
INSERT INTO likes (post_id, user_address, created_at, tx_hash) VALUES
  (1, 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABOB',  NOW() - INTERVAL '95 minutes', 'txhash-like-0001'),
  (1, 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAROL',  NOW() - INTERVAL '80 minutes', 'txhash-like-0002'),
  (2, 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALICE',  NOW() - INTERVAL '40 minutes', 'txhash-like-0003')
ON CONFLICT (post_id, user_address) DO NOTHING;

-- ── Pools ───────────────────────────────────────────────────────────────────
INSERT INTO pools (pool_id, token, balance, admins, threshold, created_ledger, updated_ledger) VALUES
  ('community', 'CTOKENAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 350,
   '["GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALICE"]'::jsonb, 1, 120, 130)
ON CONFLICT (pool_id) DO NOTHING;

-- ── Governance ──────────────────────────────────────────────────────────────
INSERT INTO governance_proposals (proposal_id, proposer, parameter, new_value, votes_for, votes_against, status, created_ledger, updated_ledger) VALUES
  (1, 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALICE', 'fee_bps', 50, 1, 0, 'Active', 140, 141)
ON CONFLICT (proposal_id) DO NOTHING;

INSERT INTO governance_votes (proposal_id, voter, support, ledger) VALUES
  (1, 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABOB', TRUE, 141)
ON CONFLICT (proposal_id, voter) DO NOTHING;

-- ── Reports ─────────────────────────────────────────────────────────────────
INSERT INTO reports (post_id, reporter_address, reason, status) VALUES
  (2, 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAROL', 'spam', 'pending')
ON CONFLICT DO NOTHING;

-- ── Indexer plumbing ────────────────────────────────────────────────────────
INSERT INTO indexer_cursor (id, processed_cursor) VALUES ('default', 200)
ON CONFLICT (id) DO NOTHING;

INSERT INTO indexer_state (ledger_sequence, state_root) VALUES
  (200, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
ON CONFLICT (ledger_sequence) DO NOTHING;

INSERT INTO raw_events (id, ledger_sequence, event_index, contract_id, topic, data) VALUES
  (1, 200, 0, 'CCONTRACTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', ARRAY['LikeEvent'], '{"post_id":1}'::jsonb)
ON CONFLICT (ledger_sequence, event_index) DO NOTHING;

-- ── Notifications (FK -> raw_events.id) ─────────────────────────────────────
INSERT INTO sent_notifications (event_id, event_type, recipient, dispatch_key) VALUES
  (1, 'LikeEvent', 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALICE', 'dispatch-0001')
ON CONFLICT (dispatch_key) DO NOTHING;

INSERT INTO device_tokens (address, token, platform) VALUES
  ('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALICE', 'ExponentPushToken[alice]', 'ios')
ON CONFLICT (address, token) DO NOTHING;

INSERT INTO notification_preferences (address) VALUES
  ('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALICE')
ON CONFLICT (address) DO NOTHING;

INSERT INTO blocks (blocker, blocked) VALUES
  ('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALICE', 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAROL')
ON CONFLICT (blocker, blocked) DO NOTHING;

INSERT INTO dm_keys (address, x25519_pubkey) VALUES
  ('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALICE', 'x25519-pubkey-alice')
ON CONFLICT (address) DO NOTHING;

COMMIT;
