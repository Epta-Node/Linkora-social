-- Schema verification for the migrated database.
--
-- Every check RAISEs an exception on failure; run this file with
-- `psql -v ON_ERROR_STOP=1` so the first failed assertion aborts the script
-- with a non-zero exit code. These assertions encode the intended final state
-- and would have caught every bug the original migrations shipped with
-- (MySQL-style inline INDEX syntax, the indexer_state name collision, and the
-- foreign key to a non-unique column).

\set ON_ERROR_STOP on

DO $$
DECLARE
    expected_tables TEXT[] := ARRAY[
        'profiles', 'posts', 'follows', 'tips', 'likes', 'pools',
        'indexer_cursor', 'indexer_state', 'raw_events', 'device_tokens',
        'sent_notifications', 'governance_proposals', 'governance_votes',
        'reports', 'blocks', 'dm_keys', 'notification_preferences'
    ];
    t TEXT;
BEGIN
    -- 1. Every expected base table must exist.
    FOREACH t IN ARRAY expected_tables LOOP
        IF to_regclass('public.' || t) IS NULL THEN
            RAISE EXCEPTION 'missing expected table: %', t;
        END IF;
    END LOOP;

    -- 2. The post_scores materialized view must exist.
    IF NOT EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'post_scores') THEN
        RAISE EXCEPTION 'missing materialized view: post_scores';
    END IF;

    -- 3. indexer_state must be the STATE-ROOT table, not the cursor. This guards
    --    the 006_indexer_state.sql / 006_raw_events.sql name-collision regression.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'indexer_state' AND column_name = 'state_root'
    ) THEN
        RAISE EXCEPTION 'indexer_state is missing the state_root column (name collision with the cursor table?)';
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'indexer_state' AND column_name = 'processed_cursor'
    ) THEN
        RAISE EXCEPTION 'indexer_state unexpectedly has processed_cursor; the cursor belongs in indexer_cursor';
    END IF;

    -- 4. The ingestion cursor lives in indexer_cursor.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'indexer_cursor' AND column_name = 'processed_cursor'
    ) THEN
        RAISE EXCEPTION 'indexer_cursor is missing the processed_cursor column';
    END IF;

    -- 5. raw_events.id must be unique so foreign keys can reference it.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = 'raw_events'::regclass
          AND i.indisunique
          AND a.attname = 'id'
          AND array_length(i.indkey::int[], 1) = 1
    ) THEN
        RAISE EXCEPTION 'raw_events.id must have a unique index';
    END IF;

    -- 6. sent_notifications.event_id must reference raw_events.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'sent_notifications'::regclass
          AND contype = 'f'
          AND confrelid = 'raw_events'::regclass
    ) THEN
        RAISE EXCEPTION 'sent_notifications is missing its foreign key to raw_events';
    END IF;

    -- 7. Full-text search column added by 009_posts_fts.sql must be present.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'posts' AND column_name = 'content_tsv'
    ) THEN
        RAISE EXCEPTION 'posts.content_tsv (full-text search) column is missing';
    END IF;

    -- 8. The reports updated_at trigger must exist.
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'reports'::regclass AND tgname = 'reports_updated_at_trigger'
    ) THEN
        RAISE EXCEPTION 'reports_updated_at_trigger is missing';
    END IF;

    -- 9. The MySQL-style inline indexes must have materialised as real indexes.
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_posts_author') THEN
        RAISE EXCEPTION 'idx_posts_author index is missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_tips_post_id') THEN
        RAISE EXCEPTION 'idx_tips_post_id index is missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_reports_status') THEN
        RAISE EXCEPTION 'idx_reports_status index is missing';
    END IF;

    RAISE NOTICE 'schema verification passed: % base tables, post_scores view, all constraints present',
        array_length(expected_tables, 1);
END $$;
