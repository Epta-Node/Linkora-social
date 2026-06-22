import { Pool } from "pg";
import { Database, Profile, Follow, Post, Like, Tip, Pool as PoolModel } from "./db";





export class PostgresDatabase implements Database {

  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  // ───────────────────────────────── Profiles ─────────────────────────────────

  async upsertProfile(profile: Profile): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO profiles (address, username, creator_token, updated_ledger)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (address)
      DO UPDATE SET
        username = EXCLUDED.username,
        creator_token = EXCLUDED.creator_token,
        updated_ledger = EXCLUDED.updated_ledger
      `,
      [profile.address, profile.username, profile.creator_token, profile.updated_ledger]
    );
  }

  async getProfile(address: string): Promise<Profile | null> {
    const res = await this.pool.query(
      `
      SELECT address, username, creator_token, updated_ledger
      FROM profiles
      WHERE address = $1
      `,
      [address]
    );
    return res.rows[0] ?? null;
  }

  // ───────────────────────────────── Follows ──────────────────────────────────

  async insertFollow(follow: Follow): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO follows (follower, followee, created_at)
      VALUES ($1, $2, to_timestamp($3))
      ON CONFLICT (follower, followee) DO NOTHING
      `,
      [follow.follower, follow.followee, follow.ledger]
    );
  }


  async deleteFollow(follower: string, followee: string): Promise<void> {
    await this.pool.query(
      `
      DELETE FROM follows
      WHERE follower = $1 AND followee = $2
      `,
      [follower, followee]
    );
  }

  async getFollowers(
    address: string,
    limit: number,
    offset: number
  ): Promise<{ followers: string[]; total: number }> {
    const totalRes = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM follows WHERE followee = $1`,
      [address]
    );
    const total = totalRes.rows[0]?.total ?? 0;

    const res = await this.pool.query(
      `
      SELECT follower
      FROM follows
      WHERE followee = $1
      ORDER BY created_at DESC
      OFFSET $2 LIMIT $3
      `,
      [address, offset, limit]
    );

    return { followers: res.rows.map((r) => r.follower as string), total };
  }

  async getFollowing(
    address: string,
    limit: number,
    offset: number
  ): Promise<{ following: string[]; total: number }> {
    const totalRes = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM follows WHERE follower = $1`,
      [address]
    );
    const total = totalRes.rows[0]?.total ?? 0;

    const res = await this.pool.query(
      `
      SELECT followee
      FROM follows
      WHERE follower = $1
      ORDER BY created_at DESC
      OFFSET $2 LIMIT $3
      `,
      [address, offset, limit]
    );

    return { following: res.rows.map((r) => r.followee as string), total };
  }

  // ───────────────────────────────── Posts ────────────────────────────────────

  async insertPost(post: Post): Promise<void> {
    const content = (post as any).content ?? '';

    await this.pool.query(
      `
      INSERT INTO posts (id, author, content, tip_total, like_count, created_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, to_timestamp($6), NULL)
      ON CONFLICT (id) DO NOTHING
      `,
      [post.id.toString(), post.author, content, post.tip_total.toString(), post.like_count.toString(), post.created_ledger]
    );
  }


  async markPostDeleted(post_id: bigint, deleted_ledger: number): Promise<void> {
    await this.pool.query(
      `
      UPDATE posts
      SET deleted_at = to_timestamp($2)
      WHERE id = $1 AND deleted_at IS NULL

      `,
      [post_id.toString(), deleted_ledger]
    );
  }


  async incrementPostLikeCount(post_id: bigint): Promise<void> {
    await this.pool.query(
      `
      UPDATE posts
      SET like_count = like_count + 1
      WHERE id = $1 AND deleted_at IS NULL
      `,
      [post_id.toString()]
    );
  }

  async addPostTipTotal(post_id: bigint, net_amount: bigint): Promise<void> {
    await this.pool.query(
      `
      UPDATE posts
      SET tip_total = tip_total + $1
      WHERE id = $2 AND deleted_at IS NULL
      `,
      [net_amount.toString(), post_id.toString()]
    );
  }

  async getPost(post_id: bigint): Promise<Post | null> {
    const res = await this.pool.query(
      `
      SELECT
        id,
        author,
        deleted_at IS NOT NULL AS deleted,
        tip_total,
        like_count,
        extract(epoch from created_at)::bigint AS created_ledger,
        CASE WHEN deleted_at IS NULL THEN NULL ELSE extract(epoch from deleted_at)::bigint END AS deleted_ledger
      FROM posts
      WHERE id = $1
      `,
      [post_id.toString()]
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0];

    return {
      id: BigInt(row.id),
      author: row.author,
      deleted: row.deleted,
      tip_total: BigInt(row.tip_total),
      like_count: BigInt(row.like_count),
      created_ledger: Number(row.created_ledger),
      deleted_ledger: row.deleted_ledger === null ? null : Number(row.deleted_ledger),
    };
  }

  async listPosts(filters: {
    author?: string;
    limit: number;
    offset: number;
  }): Promise<{ posts: Post[]; total: number }> {
    const { author, limit, offset } = filters;

    const totalRes = await this.pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM posts
      WHERE ($1::text IS NULL OR author = $1)
      `,
      [author ?? null]
    );
    const total = totalRes.rows[0]?.total ?? 0;

    const res = await this.pool.query(
      `
      SELECT
        id,
        author,
        deleted_at IS NOT NULL AS deleted,
        tip_total,
        like_count,
        extract(epoch from created_at)::bigint AS created_ledger,
        CASE WHEN deleted_at IS NULL THEN NULL ELSE extract(epoch from deleted_at)::bigint END AS deleted_ledger
      FROM posts
      WHERE ($1::text IS NULL OR author = $1)
      ORDER BY created_at DESC
      OFFSET $2 LIMIT $3
      `,
      [author ?? null, offset, limit]
    );

    const posts: Post[] = res.rows.map((row) => ({
      id: BigInt(row.id),
      author: row.author,
      deleted: row.deleted,
      tip_total: BigInt(row.tip_total),
      like_count: BigInt(row.like_count),
      created_ledger: Number(row.created_ledger),
      deleted_ledger: row.deleted_ledger === null ? null : Number(row.deleted_ledger),
    }));

    return { posts, total };
  }

  // ───────────────────────────────── Likes ────────────────────────────────────

  async upsertLike(like: Like): Promise<boolean> {
    const res = await this.pool.query(
      `
      INSERT INTO likes (post_id, user_address, created_at, tx_hash)
      VALUES ($1, $2, to_timestamp($3), '')
      ON CONFLICT (post_id, user_address) DO NOTHING
      RETURNING post_id
      `,
      [like.post_id.toString(), like.user, like.ledger]
    );
    return (res.rowCount ?? 0) > 0;
  }



  // Note: Like handler in this repo uses the raw handlers (pg Pool directly),
  // and this method exists mainly to satisfy the Database interface.

  // ───────────────────────────────── Tips ─────────────────────────────────────

  async insertTip(tip: Tip): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO tips (post_id, tipper, amount, fee, created_at, tx_hash)
      VALUES ($1, $2, $3, $4, to_timestamp($5), $6)
      ON CONFLICT (tx_hash) DO NOTHING
      `,
      [
        tip.post_id.toString(),
        tip.tipper,
        tip.amount.toString(),
        tip.fee.toString(),
        tip.ledger,
        tip.tx_hash,
      ]
    );
  }


  // ───────────────────────────────── Pools ────────────────────────────────────

  async upsertPool(pool: PoolModel): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO pools (pool_id, token, balance, admins, threshold, created_ledger, updated_ledger)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (pool_id) DO UPDATE SET
        token = EXCLUDED.token,
        balance = EXCLUDED.balance,
        admins = EXCLUDED.admins,
        threshold = EXCLUDED.threshold,
        created_ledger = EXCLUDED.created_ledger,
        updated_ledger = EXCLUDED.updated_ledger
      `,
      [
        pool.pool_id,
        pool.token,
        pool.balance.toString(),
        pool.admins,
        pool.threshold,
        pool.created_ledger,
        pool.updated_ledger,
      ]
    );
  }

  async adjustPoolBalance(
    pool_id: string,
    delta: bigint,
    ledger: number
  ): Promise<void> {
    await this.pool.query(
      `
      UPDATE pools
      SET balance = balance + $1, updated_ledger = $3
      WHERE pool_id = $2
      `,
      [delta.toString(), pool_id, ledger]
    );
  }

  async insertPool(pool: PoolModel): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO pools (pool_id, token, balance, admins, threshold, created_ledger, updated_ledger)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (pool_id) DO NOTHING
      `,
      [
        pool.pool_id,
        pool.token,
        pool.balance.toString(),
        pool.admins,
        pool.threshold,
        pool.created_ledger,
        pool.updated_ledger,
      ]
    );
  }

  async getPool(pool_id: string): Promise<PoolModel | null> {
    const res = await this.pool.query(
      `
      SELECT pool_id, token, balance, admins, threshold, created_ledger, updated_ledger
      FROM pools
      WHERE pool_id = $1
      `,
      [pool_id]
    );
    const row = res.rows[0];
    if (!row) return null;

    return {
      pool_id: row.pool_id,
      token: row.token,
      balance: BigInt(row.balance),
      admins: row.admins ?? [],
      threshold: Number(row.threshold),
      created_ledger: Number(row.created_ledger),
      updated_ledger: Number(row.updated_ledger),
    };
  }

  async addPoolAdmin(pool_id: string, admin: string, ledger: number): Promise<void> {
    await this.pool.query(
      `
      UPDATE pools
      SET admins = (
        SELECT jsonb_agg(DISTINCT elem)
        FROM jsonb_array_elements_text(admins || to_jsonb(ARRAY[$1::text])) AS elem
      ),
      updated_ledger = $2
      WHERE pool_id = $3
      `,
      [admin, ledger, pool_id]
    );
  }


  async removePoolAdmin(pool_id: string, admin: string, ledger: number): Promise<void> {
    await this.pool.query(
      `
      UPDATE pools
      SET admins = (
        SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
        FROM jsonb_array_elements_text(admins) AS elem
        WHERE elem <> $1
      ),
      updated_ledger = $2
      WHERE pool_id = $3

      `,
      [admin, ledger, pool_id]
    );
  }
}

