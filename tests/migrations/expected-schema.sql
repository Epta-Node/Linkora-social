CREATE FUNCTION public.add_pool_admin(p_pool_id text, p_admin text, p_ledger integer) RETURNS void
    LANGUAGE sql
    AS $$
    UPDATE pools
    SET    admins         = CASE
                               WHEN admins @> to_jsonb(p_admin)
                               THEN admins
                               ELSE admins || to_jsonb(p_admin)
                           END,
           updated_ledger = p_ledger
    WHERE  pool_id = p_pool_id;
$$;
CREATE FUNCTION public.remove_pool_admin(p_pool_id text, p_admin text, p_ledger integer) RETURNS void
    LANGUAGE sql
    AS $$
    UPDATE pools
    SET    admins         = (
               SELECT jsonb_agg(elem)
               FROM   jsonb_array_elements(admins) AS elem
               WHERE  elem <> to_jsonb(p_admin)
           ),
           updated_ledger = p_ledger
    WHERE  pool_id = p_pool_id;
$$;
CREATE FUNCTION public.sync_follow_counts() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;
CREATE FUNCTION public.update_reports_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;
CREATE TABLE public.blocks (
    blocker text NOT NULL,
    blocked text NOT NULL
);
CREATE TABLE public.device_tokens (
    id integer NOT NULL,
    address text NOT NULL,
    token text NOT NULL,
    platform text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_tokens_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text, 'web'::text])))
);
CREATE SEQUENCE public.device_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.device_tokens_id_seq OWNED BY public.device_tokens.id;
CREATE TABLE public.dm_keys (
    address text NOT NULL,
    x25519_pubkey text NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.follow_counts (
    user_address text NOT NULL,
    followers_count integer DEFAULT 0 NOT NULL,
    following_count integer DEFAULT 0 NOT NULL
);
CREATE TABLE public.follows (
    follower text NOT NULL,
    followee text NOT NULL,
    created_at integer NOT NULL
);
CREATE TABLE public.governance_proposals (
    proposal_id bigint NOT NULL,
    proposer text NOT NULL,
    parameter text NOT NULL,
    new_value numeric(20,0) NOT NULL,
    votes_for bigint DEFAULT 0 NOT NULL,
    votes_against bigint DEFAULT 0 NOT NULL,
    status text NOT NULL,
    created_ledger integer NOT NULL,
    updated_ledger integer NOT NULL
);
CREATE TABLE public.governance_votes (
    proposal_id bigint NOT NULL,
    voter text NOT NULL,
    support boolean NOT NULL,
    ledger integer NOT NULL
);
CREATE TABLE public.indexer_cursor (
    id text NOT NULL,
    processed_cursor bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.indexer_state (
    ledger_sequence bigint NOT NULL,
    state_root text NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.likes (
    id integer NOT NULL,
    post_id bigint NOT NULL,
    user_address text NOT NULL,
    created_at timestamp without time zone NOT NULL,
    tx_hash text NOT NULL
);
CREATE SEQUENCE public.likes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.likes_id_seq OWNED BY public.likes.id;
CREATE TABLE public.notification_preferences (
    address text NOT NULL,
    browser_push_enabled boolean DEFAULT false NOT NULL,
    new_followers boolean DEFAULT true NOT NULL,
    new_likes boolean DEFAULT true NOT NULL,
    new_comments boolean DEFAULT true NOT NULL,
    direct_messages boolean DEFAULT true NOT NULL,
    pool_activity boolean DEFAULT true NOT NULL,
    governance_updates boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.pools (
    pool_id text NOT NULL,
    token text NOT NULL,
    balance numeric(39,0) DEFAULT 0 NOT NULL,
    admins jsonb DEFAULT '[]'::jsonb NOT NULL,
    threshold integer NOT NULL,
    created_ledger integer NOT NULL,
    updated_ledger integer NOT NULL,
    CONSTRAINT pools_balance_check CHECK ((balance >= (0)::numeric)),
    CONSTRAINT pools_threshold_check CHECK ((threshold >= 1))
);
CREATE TABLE public.posts (
    id bigint NOT NULL,
    author text NOT NULL,
    content text NOT NULL,
    tip_total bigint DEFAULT 0 NOT NULL,
    like_count bigint DEFAULT 0 NOT NULL,
    created_at timestamp without time zone NOT NULL,
    deleted_at timestamp without time zone,
    content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, COALESCE(content, ''::text))) STORED
);
CREATE MATERIALIZED VIEW public.post_scores AS
 SELECT id,
    author,
    content,
    tip_total,
    like_count,
    created_at,
    (((((100 + (like_count * 5)))::numeric + ((tip_total)::numeric / (1000000)::numeric)) - (EXTRACT(epoch FROM (now() - (created_at)::timestamp with time zone)) / (3600)::numeric)))::integer AS score,
    now() AS last_updated
   FROM public.posts p
  WHERE (deleted_at IS NULL)
  WITH NO DATA;
CREATE TABLE public.profiles (
    address text NOT NULL,
    username text NOT NULL,
    creator_token text DEFAULT ''::text NOT NULL,
    updated_ledger integer DEFAULT 0 NOT NULL
);
CREATE TABLE public.raw_events (
    id bigint NOT NULL,
    ledger_sequence bigint NOT NULL,
    event_index integer NOT NULL,
    contract_id text NOT NULL,
    topic text[] NOT NULL,
    data jsonb NOT NULL,
    processed_at timestamp with time zone
)
PARTITION BY RANGE (ledger_sequence);
CREATE SEQUENCE public.raw_events_id_seq1
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.raw_events_id_seq1 OWNED BY public.raw_events.id;
CREATE TABLE public.raw_events_default (
    id bigint DEFAULT nextval('public.raw_events_id_seq1'::regclass) NOT NULL,
    ledger_sequence bigint NOT NULL,
    event_index integer NOT NULL,
    contract_id text NOT NULL,
    topic text[] NOT NULL,
    data jsonb NOT NULL,
    processed_at timestamp with time zone
);
CREATE TABLE public.raw_events_legacy (
    id bigint NOT NULL,
    ledger_sequence bigint NOT NULL,
    event_index integer NOT NULL,
    contract_id text NOT NULL,
    topic text[] NOT NULL,
    data jsonb NOT NULL,
    processed_at timestamp with time zone
);
CREATE SEQUENCE public.raw_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.raw_events_id_seq OWNED BY public.raw_events_legacy.id;
CREATE TABLE public.raw_events_p0_1000000 (
    id bigint DEFAULT nextval('public.raw_events_id_seq1'::regclass) NOT NULL,
    ledger_sequence bigint NOT NULL,
    event_index integer NOT NULL,
    contract_id text NOT NULL,
    topic text[] NOT NULL,
    data jsonb NOT NULL,
    processed_at timestamp with time zone
);
CREATE TABLE public.raw_events_p1000000_2000000 (
    id bigint DEFAULT nextval('public.raw_events_id_seq1'::regclass) NOT NULL,
    ledger_sequence bigint NOT NULL,
    event_index integer NOT NULL,
    contract_id text NOT NULL,
    topic text[] NOT NULL,
    data jsonb NOT NULL,
    processed_at timestamp with time zone
);
CREATE TABLE public.raw_events_p2000000_3000000 (
    id bigint DEFAULT nextval('public.raw_events_id_seq1'::regclass) NOT NULL,
    ledger_sequence bigint NOT NULL,
    event_index integer NOT NULL,
    contract_id text NOT NULL,
    topic text[] NOT NULL,
    data jsonb NOT NULL,
    processed_at timestamp with time zone
);
CREATE TABLE public.raw_events_p3000000_4000000 (
    id bigint DEFAULT nextval('public.raw_events_id_seq1'::regclass) NOT NULL,
    ledger_sequence bigint NOT NULL,
    event_index integer NOT NULL,
    contract_id text NOT NULL,
    topic text[] NOT NULL,
    data jsonb NOT NULL,
    processed_at timestamp with time zone
);
CREATE TABLE public.raw_events_p4000000_5000000 (
    id bigint DEFAULT nextval('public.raw_events_id_seq1'::regclass) NOT NULL,
    ledger_sequence bigint NOT NULL,
    event_index integer NOT NULL,
    contract_id text NOT NULL,
    topic text[] NOT NULL,
    data jsonb NOT NULL,
    processed_at timestamp with time zone
);
CREATE TABLE public.raw_events_p5000000_6000000 (
    id bigint DEFAULT nextval('public.raw_events_id_seq1'::regclass) NOT NULL,
    ledger_sequence bigint NOT NULL,
    event_index integer NOT NULL,
    contract_id text NOT NULL,
    topic text[] NOT NULL,
    data jsonb NOT NULL,
    processed_at timestamp with time zone
);
CREATE TABLE public.raw_events_p6000000_7000000 (
    id bigint DEFAULT nextval('public.raw_events_id_seq1'::regclass) NOT NULL,
    ledger_sequence bigint NOT NULL,
    event_index integer NOT NULL,
    contract_id text NOT NULL,
    topic text[] NOT NULL,
    data jsonb NOT NULL,
    processed_at timestamp with time zone
);
CREATE TABLE public.raw_events_p7000000_8000000 (
    id bigint DEFAULT nextval('public.raw_events_id_seq1'::regclass) NOT NULL,
    ledger_sequence bigint NOT NULL,
    event_index integer NOT NULL,
    contract_id text NOT NULL,
    topic text[] NOT NULL,
    data jsonb NOT NULL,
    processed_at timestamp with time zone
);
CREATE TABLE public.raw_events_p8000000_9000000 (
    id bigint DEFAULT nextval('public.raw_events_id_seq1'::regclass) NOT NULL,
    ledger_sequence bigint NOT NULL,
    event_index integer NOT NULL,
    contract_id text NOT NULL,
    topic text[] NOT NULL,
    data jsonb NOT NULL,
    processed_at timestamp with time zone
);
CREATE TABLE public.raw_events_p9000000_10000000 (
    id bigint DEFAULT nextval('public.raw_events_id_seq1'::regclass) NOT NULL,
    ledger_sequence bigint NOT NULL,
    event_index integer NOT NULL,
    contract_id text NOT NULL,
    topic text[] NOT NULL,
    data jsonb NOT NULL,
    processed_at timestamp with time zone
);
CREATE TABLE public.reports (
    id integer NOT NULL,
    post_id bigint NOT NULL,
    reporter_address text NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    moderator_address text,
    moderator_notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT reports_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'dismissed'::text, 'action_taken'::text])))
);
CREATE SEQUENCE public.reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.reports_id_seq OWNED BY public.reports.id;
CREATE TABLE public.sent_notifications (
    id bigint NOT NULL,
    event_id bigint NOT NULL,
    event_type text NOT NULL,
    recipient text NOT NULL,
    dispatch_key text NOT NULL,
    dispatched_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.sent_notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.sent_notifications_id_seq OWNED BY public.sent_notifications.id;
CREATE TABLE public.tips (
    id integer NOT NULL,
    post_id bigint NOT NULL,
    tipper text NOT NULL,
    amount bigint NOT NULL,
    fee bigint NOT NULL,
    created_at timestamp without time zone NOT NULL,
    tx_hash text NOT NULL
);
CREATE SEQUENCE public.tips_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.tips_id_seq OWNED BY public.tips.id;
ALTER TABLE ONLY public.raw_events ATTACH PARTITION public.raw_events_default DEFAULT;
ALTER TABLE ONLY public.raw_events ATTACH PARTITION public.raw_events_p0_1000000 FOR VALUES FROM ('0') TO ('1000000');
ALTER TABLE ONLY public.raw_events ATTACH PARTITION public.raw_events_p1000000_2000000 FOR VALUES FROM ('1000000') TO ('2000000');
ALTER TABLE ONLY public.raw_events ATTACH PARTITION public.raw_events_p2000000_3000000 FOR VALUES FROM ('2000000') TO ('3000000');
ALTER TABLE ONLY public.raw_events ATTACH PARTITION public.raw_events_p3000000_4000000 FOR VALUES FROM ('3000000') TO ('4000000');
ALTER TABLE ONLY public.raw_events ATTACH PARTITION public.raw_events_p4000000_5000000 FOR VALUES FROM ('4000000') TO ('5000000');
ALTER TABLE ONLY public.raw_events ATTACH PARTITION public.raw_events_p5000000_6000000 FOR VALUES FROM ('5000000') TO ('6000000');
ALTER TABLE ONLY public.raw_events ATTACH PARTITION public.raw_events_p6000000_7000000 FOR VALUES FROM ('6000000') TO ('7000000');
ALTER TABLE ONLY public.raw_events ATTACH PARTITION public.raw_events_p7000000_8000000 FOR VALUES FROM ('7000000') TO ('8000000');
ALTER TABLE ONLY public.raw_events ATTACH PARTITION public.raw_events_p8000000_9000000 FOR VALUES FROM ('8000000') TO ('9000000');
ALTER TABLE ONLY public.raw_events ATTACH PARTITION public.raw_events_p9000000_10000000 FOR VALUES FROM ('9000000') TO ('10000000');
ALTER TABLE ONLY public.device_tokens ALTER COLUMN id SET DEFAULT nextval('public.device_tokens_id_seq'::regclass);
ALTER TABLE ONLY public.likes ALTER COLUMN id SET DEFAULT nextval('public.likes_id_seq'::regclass);
ALTER TABLE ONLY public.raw_events ALTER COLUMN id SET DEFAULT nextval('public.raw_events_id_seq1'::regclass);
ALTER TABLE ONLY public.raw_events_legacy ALTER COLUMN id SET DEFAULT nextval('public.raw_events_id_seq'::regclass);
ALTER TABLE ONLY public.reports ALTER COLUMN id SET DEFAULT nextval('public.reports_id_seq'::regclass);
ALTER TABLE ONLY public.sent_notifications ALTER COLUMN id SET DEFAULT nextval('public.sent_notifications_id_seq'::regclass);
ALTER TABLE ONLY public.tips ALTER COLUMN id SET DEFAULT nextval('public.tips_id_seq'::regclass);
ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_pkey PRIMARY KEY (blocker, blocked);
ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_address_token_key UNIQUE (address, token);
ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.dm_keys
    ADD CONSTRAINT dm_keys_pkey PRIMARY KEY (address);
ALTER TABLE ONLY public.follow_counts
    ADD CONSTRAINT follow_counts_pkey PRIMARY KEY (user_address);
ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_pkey PRIMARY KEY (follower, followee);
ALTER TABLE ONLY public.governance_proposals
    ADD CONSTRAINT governance_proposals_pkey PRIMARY KEY (proposal_id);
ALTER TABLE ONLY public.governance_votes
    ADD CONSTRAINT governance_votes_pkey PRIMARY KEY (proposal_id, voter);
ALTER TABLE ONLY public.indexer_cursor
    ADD CONSTRAINT indexer_cursor_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.indexer_state
    ADD CONSTRAINT indexer_state_pkey PRIMARY KEY (ledger_sequence);
ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_post_id_user_address_key UNIQUE (post_id, user_address);
ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_tx_hash_key UNIQUE (tx_hash);
ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (address);
ALTER TABLE ONLY public.pools
    ADD CONSTRAINT pools_pkey PRIMARY KEY (pool_id);
ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (address);
ALTER TABLE ONLY public.raw_events
    ADD CONSTRAINT raw_events_pkey1 PRIMARY KEY (ledger_sequence, event_index);
ALTER TABLE ONLY public.raw_events_default
    ADD CONSTRAINT raw_events_default_pkey PRIMARY KEY (ledger_sequence, event_index);
ALTER TABLE ONLY public.raw_events_p0_1000000
    ADD CONSTRAINT raw_events_p0_1000000_pkey PRIMARY KEY (ledger_sequence, event_index);
ALTER TABLE ONLY public.raw_events_p1000000_2000000
    ADD CONSTRAINT raw_events_p1000000_2000000_pkey PRIMARY KEY (ledger_sequence, event_index);
ALTER TABLE ONLY public.raw_events_p2000000_3000000
    ADD CONSTRAINT raw_events_p2000000_3000000_pkey PRIMARY KEY (ledger_sequence, event_index);
ALTER TABLE ONLY public.raw_events_p3000000_4000000
    ADD CONSTRAINT raw_events_p3000000_4000000_pkey PRIMARY KEY (ledger_sequence, event_index);
ALTER TABLE ONLY public.raw_events_p4000000_5000000
    ADD CONSTRAINT raw_events_p4000000_5000000_pkey PRIMARY KEY (ledger_sequence, event_index);
ALTER TABLE ONLY public.raw_events_p5000000_6000000
    ADD CONSTRAINT raw_events_p5000000_6000000_pkey PRIMARY KEY (ledger_sequence, event_index);
ALTER TABLE ONLY public.raw_events_p6000000_7000000
    ADD CONSTRAINT raw_events_p6000000_7000000_pkey PRIMARY KEY (ledger_sequence, event_index);
ALTER TABLE ONLY public.raw_events_p7000000_8000000
    ADD CONSTRAINT raw_events_p7000000_8000000_pkey PRIMARY KEY (ledger_sequence, event_index);
ALTER TABLE ONLY public.raw_events_p8000000_9000000
    ADD CONSTRAINT raw_events_p8000000_9000000_pkey PRIMARY KEY (ledger_sequence, event_index);
ALTER TABLE ONLY public.raw_events_p9000000_10000000
    ADD CONSTRAINT raw_events_p9000000_10000000_pkey PRIMARY KEY (ledger_sequence, event_index);
ALTER TABLE ONLY public.raw_events_legacy
    ADD CONSTRAINT raw_events_pkey PRIMARY KEY (ledger_sequence, event_index);
ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.sent_notifications
    ADD CONSTRAINT sent_notifications_dispatch_key_key UNIQUE (dispatch_key);
ALTER TABLE ONLY public.sent_notifications
    ADD CONSTRAINT sent_notifications_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tips
    ADD CONSTRAINT tips_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tips
    ADD CONSTRAINT tips_tx_hash_key UNIQUE (tx_hash);
CREATE INDEX idx_blocks_blocked ON public.blocks USING btree (blocked);
CREATE INDEX idx_blocks_blocker ON public.blocks USING btree (blocker);
CREATE INDEX idx_device_tokens_address_updated ON public.device_tokens USING btree (address, updated_at DESC);
CREATE INDEX idx_follows_followee ON public.follows USING btree (followee);
CREATE INDEX idx_follows_follower ON public.follows USING btree (follower);
CREATE INDEX idx_governance_proposals_proposer ON public.governance_proposals USING btree (proposer);
CREATE INDEX idx_governance_proposals_status ON public.governance_proposals USING btree (status);
CREATE INDEX idx_governance_votes_proposal ON public.governance_votes USING btree (proposal_id);
CREATE INDEX idx_likes_created_at ON public.likes USING btree (created_at DESC);
CREATE INDEX idx_likes_post_id ON public.likes USING btree (post_id);
CREATE INDEX idx_likes_user ON public.likes USING btree (user_address);
CREATE INDEX idx_pools_token ON public.pools USING btree (token);
CREATE INDEX idx_post_scores_author ON public.post_scores USING btree (author, created_at DESC);
CREATE UNIQUE INDEX idx_post_scores_id ON public.post_scores USING btree (id);
CREATE INDEX idx_post_scores_score ON public.post_scores USING btree (score DESC);
CREATE INDEX idx_posts_active ON public.posts USING btree (created_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX idx_posts_author ON public.posts USING btree (author);
CREATE INDEX idx_posts_content_fts ON public.posts USING gin (content_tsv);
CREATE INDEX idx_posts_created_at ON public.posts USING btree (created_at DESC);
CREATE INDEX idx_posts_deleted_at ON public.posts USING btree (deleted_at);
CREATE INDEX idx_profiles_username ON public.profiles USING btree (username);
CREATE INDEX idx_raw_events_contract_id ON public.raw_events_legacy USING btree (contract_id);
CREATE INDEX idx_raw_events_contract_id1 ON ONLY public.raw_events USING btree (contract_id);
CREATE UNIQUE INDEX idx_raw_events_id ON public.raw_events_legacy USING btree (id);
CREATE UNIQUE INDEX idx_raw_events_id1 ON ONLY public.raw_events USING btree (id, ledger_sequence);
CREATE INDEX idx_raw_events_ledger ON public.raw_events_legacy USING btree (ledger_sequence);
CREATE INDEX idx_raw_events_ledger1 ON ONLY public.raw_events USING btree (ledger_sequence);
CREATE INDEX idx_raw_events_unprocessed ON ONLY public.raw_events USING btree (ledger_sequence, event_index) WHERE (processed_at IS NULL);
CREATE INDEX idx_reports_created_at ON public.reports USING btree (created_at DESC);
CREATE INDEX idx_reports_post_id ON public.reports USING btree (post_id);
CREATE INDEX idx_reports_reporter ON public.reports USING btree (reporter_address);
CREATE INDEX idx_reports_status ON public.reports USING btree (status);
CREATE INDEX idx_sent_notifications_recipient ON public.sent_notifications USING btree (recipient, dispatched_at DESC);
CREATE INDEX idx_tips_created_at ON public.tips USING btree (created_at DESC);
CREATE INDEX idx_tips_post_id ON public.tips USING btree (post_id);
CREATE INDEX idx_tips_tipper ON public.tips USING btree (tipper);
CREATE INDEX raw_events_default_contract_id_idx ON public.raw_events_default USING btree (contract_id);
CREATE UNIQUE INDEX raw_events_default_id_ledger_sequence_idx ON public.raw_events_default USING btree (id, ledger_sequence);
CREATE INDEX raw_events_default_ledger_sequence_event_index_idx ON public.raw_events_default USING btree (ledger_sequence, event_index) WHERE (processed_at IS NULL);
CREATE INDEX raw_events_default_ledger_sequence_idx ON public.raw_events_default USING btree (ledger_sequence);
CREATE INDEX raw_events_p0_1000000_contract_id_idx ON public.raw_events_p0_1000000 USING btree (contract_id);
CREATE UNIQUE INDEX raw_events_p0_1000000_id_ledger_sequence_idx ON public.raw_events_p0_1000000 USING btree (id, ledger_sequence);
CREATE INDEX raw_events_p0_1000000_ledger_sequence_event_index_idx ON public.raw_events_p0_1000000 USING btree (ledger_sequence, event_index) WHERE (processed_at IS NULL);
CREATE INDEX raw_events_p0_1000000_ledger_sequence_idx ON public.raw_events_p0_1000000 USING btree (ledger_sequence);
CREATE INDEX raw_events_p1000000_2000000_contract_id_idx ON public.raw_events_p1000000_2000000 USING btree (contract_id);
CREATE UNIQUE INDEX raw_events_p1000000_2000000_id_ledger_sequence_idx ON public.raw_events_p1000000_2000000 USING btree (id, ledger_sequence);
CREATE INDEX raw_events_p1000000_2000000_ledger_sequence_event_index_idx ON public.raw_events_p1000000_2000000 USING btree (ledger_sequence, event_index) WHERE (processed_at IS NULL);
CREATE INDEX raw_events_p1000000_2000000_ledger_sequence_idx ON public.raw_events_p1000000_2000000 USING btree (ledger_sequence);
CREATE INDEX raw_events_p2000000_3000000_contract_id_idx ON public.raw_events_p2000000_3000000 USING btree (contract_id);
CREATE UNIQUE INDEX raw_events_p2000000_3000000_id_ledger_sequence_idx ON public.raw_events_p2000000_3000000 USING btree (id, ledger_sequence);
CREATE INDEX raw_events_p2000000_3000000_ledger_sequence_event_index_idx ON public.raw_events_p2000000_3000000 USING btree (ledger_sequence, event_index) WHERE (processed_at IS NULL);
CREATE INDEX raw_events_p2000000_3000000_ledger_sequence_idx ON public.raw_events_p2000000_3000000 USING btree (ledger_sequence);
CREATE INDEX raw_events_p3000000_4000000_contract_id_idx ON public.raw_events_p3000000_4000000 USING btree (contract_id);
CREATE UNIQUE INDEX raw_events_p3000000_4000000_id_ledger_sequence_idx ON public.raw_events_p3000000_4000000 USING btree (id, ledger_sequence);
CREATE INDEX raw_events_p3000000_4000000_ledger_sequence_event_index_idx ON public.raw_events_p3000000_4000000 USING btree (ledger_sequence, event_index) WHERE (processed_at IS NULL);
CREATE INDEX raw_events_p3000000_4000000_ledger_sequence_idx ON public.raw_events_p3000000_4000000 USING btree (ledger_sequence);
CREATE INDEX raw_events_p4000000_5000000_contract_id_idx ON public.raw_events_p4000000_5000000 USING btree (contract_id);
CREATE UNIQUE INDEX raw_events_p4000000_5000000_id_ledger_sequence_idx ON public.raw_events_p4000000_5000000 USING btree (id, ledger_sequence);
CREATE INDEX raw_events_p4000000_5000000_ledger_sequence_event_index_idx ON public.raw_events_p4000000_5000000 USING btree (ledger_sequence, event_index) WHERE (processed_at IS NULL);
CREATE INDEX raw_events_p4000000_5000000_ledger_sequence_idx ON public.raw_events_p4000000_5000000 USING btree (ledger_sequence);
CREATE INDEX raw_events_p5000000_6000000_contract_id_idx ON public.raw_events_p5000000_6000000 USING btree (contract_id);
CREATE UNIQUE INDEX raw_events_p5000000_6000000_id_ledger_sequence_idx ON public.raw_events_p5000000_6000000 USING btree (id, ledger_sequence);
CREATE INDEX raw_events_p5000000_6000000_ledger_sequence_event_index_idx ON public.raw_events_p5000000_6000000 USING btree (ledger_sequence, event_index) WHERE (processed_at IS NULL);
CREATE INDEX raw_events_p5000000_6000000_ledger_sequence_idx ON public.raw_events_p5000000_6000000 USING btree (ledger_sequence);
CREATE INDEX raw_events_p6000000_7000000_contract_id_idx ON public.raw_events_p6000000_7000000 USING btree (contract_id);
CREATE UNIQUE INDEX raw_events_p6000000_7000000_id_ledger_sequence_idx ON public.raw_events_p6000000_7000000 USING btree (id, ledger_sequence);
CREATE INDEX raw_events_p6000000_7000000_ledger_sequence_event_index_idx ON public.raw_events_p6000000_7000000 USING btree (ledger_sequence, event_index) WHERE (processed_at IS NULL);
CREATE INDEX raw_events_p6000000_7000000_ledger_sequence_idx ON public.raw_events_p6000000_7000000 USING btree (ledger_sequence);
CREATE INDEX raw_events_p7000000_8000000_contract_id_idx ON public.raw_events_p7000000_8000000 USING btree (contract_id);
CREATE UNIQUE INDEX raw_events_p7000000_8000000_id_ledger_sequence_idx ON public.raw_events_p7000000_8000000 USING btree (id, ledger_sequence);
CREATE INDEX raw_events_p7000000_8000000_ledger_sequence_event_index_idx ON public.raw_events_p7000000_8000000 USING btree (ledger_sequence, event_index) WHERE (processed_at IS NULL);
CREATE INDEX raw_events_p7000000_8000000_ledger_sequence_idx ON public.raw_events_p7000000_8000000 USING btree (ledger_sequence);
CREATE INDEX raw_events_p8000000_9000000_contract_id_idx ON public.raw_events_p8000000_9000000 USING btree (contract_id);
CREATE UNIQUE INDEX raw_events_p8000000_9000000_id_ledger_sequence_idx ON public.raw_events_p8000000_9000000 USING btree (id, ledger_sequence);
CREATE INDEX raw_events_p8000000_9000000_ledger_sequence_event_index_idx ON public.raw_events_p8000000_9000000 USING btree (ledger_sequence, event_index) WHERE (processed_at IS NULL);
CREATE INDEX raw_events_p8000000_9000000_ledger_sequence_idx ON public.raw_events_p8000000_9000000 USING btree (ledger_sequence);
CREATE INDEX raw_events_p9000000_10000000_contract_id_idx ON public.raw_events_p9000000_10000000 USING btree (contract_id);
CREATE UNIQUE INDEX raw_events_p9000000_10000000_id_ledger_sequence_idx ON public.raw_events_p9000000_10000000 USING btree (id, ledger_sequence);
CREATE INDEX raw_events_p9000000_10000000_ledger_sequence_event_index_idx ON public.raw_events_p9000000_10000000 USING btree (ledger_sequence, event_index) WHERE (processed_at IS NULL);
CREATE INDEX raw_events_p9000000_10000000_ledger_sequence_idx ON public.raw_events_p9000000_10000000 USING btree (ledger_sequence);
ALTER INDEX public.idx_raw_events_contract_id1 ATTACH PARTITION public.raw_events_default_contract_id_idx;
ALTER INDEX public.idx_raw_events_id1 ATTACH PARTITION public.raw_events_default_id_ledger_sequence_idx;
ALTER INDEX public.idx_raw_events_unprocessed ATTACH PARTITION public.raw_events_default_ledger_sequence_event_index_idx;
ALTER INDEX public.idx_raw_events_ledger1 ATTACH PARTITION public.raw_events_default_ledger_sequence_idx;
ALTER INDEX public.raw_events_pkey1 ATTACH PARTITION public.raw_events_default_pkey;
ALTER INDEX public.idx_raw_events_contract_id1 ATTACH PARTITION public.raw_events_p0_1000000_contract_id_idx;
ALTER INDEX public.idx_raw_events_id1 ATTACH PARTITION public.raw_events_p0_1000000_id_ledger_sequence_idx;
ALTER INDEX public.idx_raw_events_unprocessed ATTACH PARTITION public.raw_events_p0_1000000_ledger_sequence_event_index_idx;
ALTER INDEX public.idx_raw_events_ledger1 ATTACH PARTITION public.raw_events_p0_1000000_ledger_sequence_idx;
ALTER INDEX public.raw_events_pkey1 ATTACH PARTITION public.raw_events_p0_1000000_pkey;
ALTER INDEX public.idx_raw_events_contract_id1 ATTACH PARTITION public.raw_events_p1000000_2000000_contract_id_idx;
ALTER INDEX public.idx_raw_events_id1 ATTACH PARTITION public.raw_events_p1000000_2000000_id_ledger_sequence_idx;
ALTER INDEX public.idx_raw_events_unprocessed ATTACH PARTITION public.raw_events_p1000000_2000000_ledger_sequence_event_index_idx;
ALTER INDEX public.idx_raw_events_ledger1 ATTACH PARTITION public.raw_events_p1000000_2000000_ledger_sequence_idx;
ALTER INDEX public.raw_events_pkey1 ATTACH PARTITION public.raw_events_p1000000_2000000_pkey;
ALTER INDEX public.idx_raw_events_contract_id1 ATTACH PARTITION public.raw_events_p2000000_3000000_contract_id_idx;
ALTER INDEX public.idx_raw_events_id1 ATTACH PARTITION public.raw_events_p2000000_3000000_id_ledger_sequence_idx;
ALTER INDEX public.idx_raw_events_unprocessed ATTACH PARTITION public.raw_events_p2000000_3000000_ledger_sequence_event_index_idx;
ALTER INDEX public.idx_raw_events_ledger1 ATTACH PARTITION public.raw_events_p2000000_3000000_ledger_sequence_idx;
ALTER INDEX public.raw_events_pkey1 ATTACH PARTITION public.raw_events_p2000000_3000000_pkey;
ALTER INDEX public.idx_raw_events_contract_id1 ATTACH PARTITION public.raw_events_p3000000_4000000_contract_id_idx;
ALTER INDEX public.idx_raw_events_id1 ATTACH PARTITION public.raw_events_p3000000_4000000_id_ledger_sequence_idx;
ALTER INDEX public.idx_raw_events_unprocessed ATTACH PARTITION public.raw_events_p3000000_4000000_ledger_sequence_event_index_idx;
ALTER INDEX public.idx_raw_events_ledger1 ATTACH PARTITION public.raw_events_p3000000_4000000_ledger_sequence_idx;
ALTER INDEX public.raw_events_pkey1 ATTACH PARTITION public.raw_events_p3000000_4000000_pkey;
ALTER INDEX public.idx_raw_events_contract_id1 ATTACH PARTITION public.raw_events_p4000000_5000000_contract_id_idx;
ALTER INDEX public.idx_raw_events_id1 ATTACH PARTITION public.raw_events_p4000000_5000000_id_ledger_sequence_idx;
ALTER INDEX public.idx_raw_events_unprocessed ATTACH PARTITION public.raw_events_p4000000_5000000_ledger_sequence_event_index_idx;
ALTER INDEX public.idx_raw_events_ledger1 ATTACH PARTITION public.raw_events_p4000000_5000000_ledger_sequence_idx;
ALTER INDEX public.raw_events_pkey1 ATTACH PARTITION public.raw_events_p4000000_5000000_pkey;
ALTER INDEX public.idx_raw_events_contract_id1 ATTACH PARTITION public.raw_events_p5000000_6000000_contract_id_idx;
ALTER INDEX public.idx_raw_events_id1 ATTACH PARTITION public.raw_events_p5000000_6000000_id_ledger_sequence_idx;
ALTER INDEX public.idx_raw_events_unprocessed ATTACH PARTITION public.raw_events_p5000000_6000000_ledger_sequence_event_index_idx;
ALTER INDEX public.idx_raw_events_ledger1 ATTACH PARTITION public.raw_events_p5000000_6000000_ledger_sequence_idx;
ALTER INDEX public.raw_events_pkey1 ATTACH PARTITION public.raw_events_p5000000_6000000_pkey;
ALTER INDEX public.idx_raw_events_contract_id1 ATTACH PARTITION public.raw_events_p6000000_7000000_contract_id_idx;
ALTER INDEX public.idx_raw_events_id1 ATTACH PARTITION public.raw_events_p6000000_7000000_id_ledger_sequence_idx;
ALTER INDEX public.idx_raw_events_unprocessed ATTACH PARTITION public.raw_events_p6000000_7000000_ledger_sequence_event_index_idx;
ALTER INDEX public.idx_raw_events_ledger1 ATTACH PARTITION public.raw_events_p6000000_7000000_ledger_sequence_idx;
ALTER INDEX public.raw_events_pkey1 ATTACH PARTITION public.raw_events_p6000000_7000000_pkey;
ALTER INDEX public.idx_raw_events_contract_id1 ATTACH PARTITION public.raw_events_p7000000_8000000_contract_id_idx;
ALTER INDEX public.idx_raw_events_id1 ATTACH PARTITION public.raw_events_p7000000_8000000_id_ledger_sequence_idx;
ALTER INDEX public.idx_raw_events_unprocessed ATTACH PARTITION public.raw_events_p7000000_8000000_ledger_sequence_event_index_idx;
ALTER INDEX public.idx_raw_events_ledger1 ATTACH PARTITION public.raw_events_p7000000_8000000_ledger_sequence_idx;
ALTER INDEX public.raw_events_pkey1 ATTACH PARTITION public.raw_events_p7000000_8000000_pkey;
ALTER INDEX public.idx_raw_events_contract_id1 ATTACH PARTITION public.raw_events_p8000000_9000000_contract_id_idx;
ALTER INDEX public.idx_raw_events_id1 ATTACH PARTITION public.raw_events_p8000000_9000000_id_ledger_sequence_idx;
ALTER INDEX public.idx_raw_events_unprocessed ATTACH PARTITION public.raw_events_p8000000_9000000_ledger_sequence_event_index_idx;
ALTER INDEX public.idx_raw_events_ledger1 ATTACH PARTITION public.raw_events_p8000000_9000000_ledger_sequence_idx;
ALTER INDEX public.raw_events_pkey1 ATTACH PARTITION public.raw_events_p8000000_9000000_pkey;
ALTER INDEX public.idx_raw_events_contract_id1 ATTACH PARTITION public.raw_events_p9000000_10000000_contract_id_idx;
ALTER INDEX public.idx_raw_events_id1 ATTACH PARTITION public.raw_events_p9000000_10000000_id_ledger_sequence_idx;
ALTER INDEX public.idx_raw_events_unprocessed ATTACH PARTITION public.raw_events_p9000000_10000000_ledger_sequence_event_index_idx;
ALTER INDEX public.idx_raw_events_ledger1 ATTACH PARTITION public.raw_events_p9000000_10000000_ledger_sequence_idx;
ALTER INDEX public.raw_events_pkey1 ATTACH PARTITION public.raw_events_p9000000_10000000_pkey;
CREATE TRIGGER reports_updated_at_trigger BEFORE UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION public.update_reports_updated_at();
CREATE TRIGGER update_follow_counts_trigger AFTER INSERT OR DELETE ON public.follows FOR EACH ROW EXECUTE FUNCTION public.sync_follow_counts();
ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id);
ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id);
ALTER TABLE ONLY public.sent_notifications
    ADD CONSTRAINT sent_notifications_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.raw_events_legacy(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tips
    ADD CONSTRAINT tips_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id);
