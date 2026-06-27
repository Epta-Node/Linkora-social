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

export interface Pool {
  pool_id: string;
  token: string;
  balance: bigint;
  admins: string[];
  threshold: number;
  created_ledger: number;
  updated_ledger: number;
}

export interface Database {
  // Profiles
  upsertProfile(profile: Profile): Promise<void>;

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

  // Pools
  upsertPool(pool: Pool): Promise<void>;
  adjustPoolBalance(pool_id: string, delta: bigint, ledger: number): Promise<void>;
  insertPool(pool: Pool): Promise<void>;
  getPool(pool_id: string): Promise<Pool | null>;
  addPoolAdmin(pool_id: string, admin: string, ledger: number): Promise<void>;
  removePoolAdmin(pool_id: string, admin: string, ledger: number): Promise<void>;

  // Query methods used by the REST API
  getProfile(address: string): Promise<Profile | null>;
  listPosts(filters: {
    author?: string;
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

  // Feed methods
  getExploreFeed(limit: number, cursor?: number): Promise<{ posts: Post[]; total: number; hasMore: boolean }>;
  getFollowingFeed(address: string, limit: number, cursor?: number): Promise<{ posts: Post[]; total: number; hasMore: boolean }>;
  refreshPostScores(): Promise<void>;
}
