/**
 * Database interface for the Linkora indexer.
 *
 * All methods are async so implementations can use any storage backend
 * (PostgreSQL, SQLite, in-memory, etc.).  The handler tests mock this
 * interface with jest.mock so no real database is required during testing.
 */

export interface Profile {
  address: string;
  username: string;
  creator_token: string;
  updated_ledger: number;
  /** Populated by search queries; omitted by plain profile lookups. */
  follower_count?: number;
}

export interface Follow {
  follower: string;
  followee: string;
  ledger: number;
}

export interface Post {
  id: bigint;
  author: string;
  deleted: boolean;
  tip_total: bigint;
  like_count: bigint;
  created_ledger: number;
  deleted_ledger: number | null;
  content: string;
  tags?: string[];
}

export interface Like {
  post_id: bigint;
  user: string;
  ledger: number;
}

export interface Tip {
  id?: number;
  tipper: string;
  post_id: bigint;
  amount: bigint;
  fee: bigint;
  ledger: number;
  tx_hash: string;
}

export interface Report {
  id?: number;
  post_id: bigint;
  reporter_address: string;
  reason: string;
  status: "pending" | "dismissed" | "action_taken";
  moderator_address?: string;
  moderator_notes?: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface Pool {
  pool_id: string;
  token: string;
  balance: bigint;
  admins: string[];
  threshold: number;
  created_ledger: number;
  updated_ledger: number;
}

export interface PoolAnalytics {
  total_deposited: string;
  total_withdrawn: string;
  contributor_count: number;
  recent_events: PoolEvent[];
  volume_7d: string;
  volume_30d: string;
}

export interface PoolEvent {
  type: "deposit" | "withdraw";
  address: string;
  amount: string;
  ledger: number;
  timestamp: string;
}

export interface GovernanceProposal {
  proposal_id: bigint;
  proposer: string;
  parameter: string;
  new_value: bigint;
  votes_for: bigint;
  votes_against: bigint;
  status: string; // 'Active', 'Passed', 'Executed', 'Vetoed', 'Failed'
  created_ledger: number;
  updated_ledger: number;
}

export interface GovernanceVote {
  proposal_id: bigint;
  voter: string;
  support: boolean;
  ledger: number;
}

/**
 * A single on-chain event as stored in `raw_events`, exposed via the public
 * `/api/events` endpoint.  `data` is the decoded JSONB payload from the
 * contract event.
 */
export interface ChainEvent {
  id: bigint;
  ledger_sequence: number;
  event_index: number;
  contract_id: string;
  topic: string[];
  data: Record<string, unknown>;
  processed_at: Date | null;
}

export interface Database {
  // Profiles
  upsertProfile(profile: Profile): Promise<void>;
  deleteProfile(address: string): Promise<void>;

  // Follows
  insertFollow(follow: Follow): Promise<void>;
  deleteFollow(follower: string, followee: string): Promise<void>;

  // Posts
  insertPost(post: Post): Promise<void>;
  markPostDeleted(post_id: bigint, deleted_ledger: number): Promise<void>;
  incrementPostLikeCount(post_id: bigint): Promise<void>;
  addPostTipTotal(post_id: bigint, net_amount: bigint): Promise<void>;
  getPost(post_id: bigint): Promise<Post | null>;

  // Likes
  upsertLike(like: Like): Promise<boolean>; // returns true if newly inserted

  // Tips
  insertTip(tip: Tip): Promise<void>;

  // Reports
  insertReport(report: Report): Promise<void>;
  updateReportStatus(
    post_id: bigint,
    reporter_address: string,
    status: "dismissed" | "action_taken",
    moderator_address?: string,
    moderator_notes?: string
  ): Promise<void>;
  getPostReports(post_id: bigint): Promise<Report[]>;

  // Pools
  upsertPool(pool: Pool): Promise<void>;
  adjustPoolBalance(pool_id: string, delta: bigint, ledger: number): Promise<void>;
  insertPool(pool: Pool): Promise<void>;
  getPool(pool_id: string): Promise<Pool | null>;
  listPools(): Promise<Pool[]>;
  getPoolAnalytics(pool_id: string): Promise<PoolAnalytics>;
  addPoolAdmin(pool_id: string, admin: string, ledger: number): Promise<void>;
  removePoolAdmin(pool_id: string, admin: string, ledger: number): Promise<void>;

  // Governance
  upsertGovernanceProposal(
    proposal: Omit<GovernanceProposal, "votes_for" | "votes_against">
  ): Promise<void>;
  updateGovernanceProposalStatus(
    proposal_id: bigint,
    status: string,
    ledger: number
  ): Promise<void>;
  insertGovernanceVote(vote: GovernanceVote): Promise<boolean>; // returns true if newly inserted
  listGovernanceProposals(filters: {
    limit: number;
    offset: number;
  }): Promise<{ proposals: GovernanceProposal[]; total: number }>;

  // Query methods used by the REST API
  getProfile(address: string): Promise<Profile | null>;
  listPosts(filters: {
    author?: string;
    limit: number;
    offset: number;
  }): Promise<{ posts: Post[]; total: number }>;
  searchPosts(filters: {
    q?: string;
    tag?: string;
    limit: number;
    offset: number;
  }): Promise<{ posts: Post[]; total: number }>;
  searchProfiles(filters: {
    q: string;
    limit: number;
    offset: number;
  }): Promise<{ profiles: Profile[]; total: number }>;
  searchPools(filters: {
    q: string;
    limit: number;
    offset: number;
  }): Promise<{ pools: Pool[]; total: number }>;
  search(filters: {
    q: string;
    type?: "posts" | "profiles" | "pools" | "all";
    limit: number;
    offset: number;
  }): Promise<{
    posts?: Post[];
    profiles?: Profile[];
    pools?: Pool[];
    total: number;
  }>;
  /**
   * Cursor-based post list. `cursor` is the opaque base64 token from the
   * previous response's `next_cursor` field (encodes `"isoTimestamp|id"`).
   * Returns `next_cursor: null` when no further pages exist.
   */
  listPostsCursor(filters: {
    author?: string;
    limit: number;
    cursor?: string;
  }): Promise<{ posts: Post[]; nextCursor: string | null }>;

  /**
   * Cursor-based governance proposal list.
   * `cursor` encodes `"proposalId|proposalId"` (numeric, proposal_id DESC).
   */
  listGovernanceProposalsCursor(filters: {
    limit: number;
    cursor?: string;
  }): Promise<{ proposals: GovernanceProposal[]; nextCursor: string | null }>;

  /**
   * Cursor-based pool list. `cursor` encodes `"isoTimestamp|pool_id"`.
   */
  listPoolsCursor(filters: {
    limit: number;
    cursor?: string;
  }): Promise<{ pools: Pool[]; nextCursor: string | null }>;

  /**
   * Cursor-based profiles list. `cursor` encodes `"isoTimestamp|address"`.
   */
  listProfilesCursor(filters: {
    limit: number;
    cursor?: string;
  }): Promise<{ profiles: Profile[]; nextCursor: string | null }>;

  /**
   * Cursor-based on-chain events list sorted by (ledger_sequence DESC, event_index DESC).
   * `cursor` encodes `"ledgerSequence|eventIndex"` — both numeric.
   * Optionally filtered by `contract_id` and/or a `topic` prefix string.
   */
  listEventsCursor(filters: {
    limit: number;
    cursor?: string;
    contract_id?: string;
    topic?: string;
  }): Promise<{ events: ChainEvent[]; nextCursor: string | null }>;

  getFeed?(filters: {
    viewer?: string;
    limit: number;
    offset: number;
  }): Promise<{ posts: Post[]; total: number }>;

  getFollowers(
    address: string,
    limit: number,
    offset: number
  ): Promise<{ followers: string[]; total: number }>;
  getFollowing(
    address: string,
    limit: number,
    offset: number
  ): Promise<{ following: string[]; total: number }>;

  // Blocks
  insertBlock(block: { blocker: string; blocked: string }): Promise<void>;
  deleteBlock(blocker: string, blocked: string): Promise<void>;
  getBlockedUsers(
    address: string,
    limit: number,
    offset: number
  ): Promise<{ blocked: string[]; total: number }>;

  // DM Keys
  upsertDmKey(dmKey: { address: string; x25519_pubkey: string }): Promise<void>;
  getDmKey(address: string): Promise<string | null>;
}
