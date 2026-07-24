import { Pool } from "pg";
import {
  Database,
  Profile,
  Follow,
  Post,
  Like,
  Tip,
  Pool as PoolModel,
  GovernanceProposal,
  GovernanceVote,
} from "./db";

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

  async deleteProfile(address: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM profiles WHERE address = $1`,
      [address]
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
    const content = (post as { content?: string }).content ?? "";

    await this.pool.query(
      `
      INSERT INTO posts (id, author, content, tip_total, like_count, created_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, to_timestamp($6), NULL)
      ON CONFLICT (id) DO NOTHING
      `,
      [
        post.id.toString(),
        post.author,
        content,
        post.tip_total.toString(),
        post.like_count.toString(),
        post.created_ledger,
      ]
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
        content,
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
      content: row.content,
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
        content,
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
      content: row.content,
      deleted: row.deleted,
      tip_total: BigInt(row.tip_total),
      like_count: BigInt(row.like_count),
      created_ledger: Number(row.created_ledger),
      deleted_ledger: row.deleted_ledger === null ? null : Number(row.deleted_ledger),
    }));

    return { posts, total };
  }

  async searchPosts(filters: {
    q: string;
    limit: number;
    offset: number;
  }): Promise<{ posts: Post[]; total: number }> {
    const { q, limit, offset } = filters;

    const sanitised = q
      .trim()
      .replace(/[^\w\s]/gu, " ")
      .trim();

    if (!sanitised) {
      return { posts: [], total: 0 };
    }

    const tsQuery = sanitised
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `${t}:*`)
      .join(" & ");

    const totalRes = await this.pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM posts
      WHERE deleted_at IS NULL
        AND content_tsv @@ to_tsquery('english', $1)
      `,
      [tsQuery]
    );
    const total = totalRes.rows[0]?.total ?? 0;

    const res = await this.pool.query(
      `
      SELECT
        id,
        author,
        content,
        deleted_at IS NOT NULL AS deleted,
        tip_total,
        like_count,
        extract(epoch from created_at)::bigint AS created_ledger,
        CASE WHEN deleted_at IS NULL THEN NULL ELSE extract(epoch from deleted_at)::bigint END AS deleted_ledger,
        ts_rank(content_tsv, to_tsquery('english', $1)) AS rank
      FROM posts
      WHERE deleted_at IS NULL
        AND content_tsv @@ to_tsquery('english', $1)
      ORDER BY rank DESC, created_at DESC
      OFFSET $2 LIMIT $3
      `,
      [tsQuery, offset, limit]
    );

    const posts: Post[] = res.rows.map((row) => ({
      id: BigInt(row.id),
      author: row.author,
      content: row.content,
      deleted: row.deleted,
      tip_total: BigInt(row.tip_total),
      like_count: BigInt(row.like_count),
      created_ledger: Number(row.created_ledger),
      deleted_ledger: row.deleted_ledger === null ? null : Number(row.deleted_ledger),
    }));

    return { posts, total };
  }

  async listPostsCursor(filters: {
    author?: string;
    limit: number;
    cursor?: number;
  }): Promise<{ posts: Post[]; total: number; hasMore: boolean }> {
    const { author, limit, cursor } = filters;

    const totalRes = await this.pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM posts
      WHERE ($1::text IS NULL OR author = $1)
      `,
      [author ?? null]
    );
    const total = totalRes.rows[0]?.total ?? 0;

    if (cursor !== undefined) {
      const res = await this.pool.query(
        `
        SELECT
          id,
          author,
          content,
          deleted_at IS NOT NULL AS deleted,
          tip_total,
          like_count,
          extract(epoch from created_at)::bigint AS created_ledger,
          CASE WHEN deleted_at IS NULL THEN NULL ELSE extract(epoch from deleted_at)::bigint END AS deleted_ledger
        FROM posts
        WHERE ($1::text IS NULL OR author = $1)
          AND created_at < to_timestamp($2)
        ORDER BY created_at DESC
        LIMIT $3
        `,
        [author ?? null, cursor, limit + 1]
      );

      const hasMore = res.rows.length > limit;
      const rows = hasMore ? res.rows.slice(0, limit) : res.rows;

      const posts: Post[] = rows.map((row) => ({
        id: BigInt(row.id),
        author: row.author,
        content: row.content,
        deleted: row.deleted,
        tip_total: BigInt(row.tip_total),
        like_count: BigInt(row.like_count),
        created_ledger: Number(row.created_ledger),
        deleted_ledger: row.deleted_ledger === null ? null : Number(row.deleted_ledger),
      }));

      return { posts, total, hasMore };
    }

    const res = await this.pool.query(
      `
      SELECT
        id,
        author,
        content,
        deleted_at IS NOT NULL AS deleted,
        tip_total,
        like_count,
        extract(epoch from created_at)::bigint AS created_ledger,
        CASE WHEN deleted_at IS NULL THEN NULL ELSE extract(epoch from deleted_at)::bigint END AS deleted_ledger
      FROM posts
      WHERE ($1::text IS NULL OR author = $1)
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [author ?? null, limit + 1]
    );

    const hasMore = res.rows.length > limit;
    const rows = hasMore ? res.rows.slice(0, limit) : res.rows;

    const posts: Post[] = rows.map((row) => ({
      id: BigInt(row.id),
      author: row.author,
      content: row.content,
      deleted: row.deleted,
      tip_total: BigInt(row.tip_total),
      like_count: BigInt(row.like_count),
      created_ledger: Number(row.created_ledger),
      deleted_ledger: row.deleted_ledger === null ? null : Number(row.deleted_ledger),
    }));

    return { posts, total, hasMore };
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

  async adjustPoolBalance(pool_id: string, delta: bigint, ledger: number): Promise<void> {
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

  async listPools(): Promise<PoolModel[]> {
    const res = await this.pool.query(
      `
      SELECT pool_id, token, balance, admins, threshold, created_ledger, updated_ledger
      FROM pools
      ORDER BY created_ledger DESC
      `
    );
    return res.rows.map((row) => ({
      pool_id: row.pool_id,
      token: row.token,
      balance: BigInt(row.balance),
      admins: row.admins ?? [],
      threshold: Number(row.threshold),
      created_ledger: Number(row.created_ledger),
      updated_ledger: Number(row.updated_ledger),
    }));
  }

  async getPoolAnalytics(pool_id: string): Promise<import("./db").PoolAnalytics> {
    const eventsRes = await this.pool.query(
      `
      SELECT
        type,
        address,
        amount,
        ledger,
        created_at
      FROM pool_events
      WHERE pool_id = $1
      ORDER BY ledger DESC
      LIMIT 50
      `,
      [pool_id]
    );

    const events = eventsRes.rows.map((row) => ({
      type: row.type as "deposit" | "withdraw",
      address: row.address,
      amount: String(row.amount),
      ledger: Number(row.ledger),
      timestamp: row.created_at?.toISOString?.() ?? "",
    }));

    const deposits = events.filter((e) => e.type === "deposit");
    const withdrawals = events.filter((e) => e.type === "withdraw");

    const totalDeposited = deposits.reduce((sum, e) => sum + BigInt(e.amount), BigInt(0));
    const totalWithdrawn = withdrawals.reduce((sum, e) => sum + BigInt(e.amount), BigInt(0));

    const uniqueContributors = new Set(events.map((e) => e.address));

    return {
      total_deposited: totalDeposited.toString(),
      total_withdrawn: totalWithdrawn.toString(),
      contributor_count: uniqueContributors.size,
      recent_events: events.slice(0, 20),
      volume_7d: totalDeposited.toString(),
      volume_30d: totalDeposited.toString(),
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

  // ────────────────────────────── Governance ──────────────────────────────────

  async upsertGovernanceProposal(
    proposal: Omit<GovernanceProposal, "votes_for" | "votes_against">
  ): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO governance_proposals (proposal_id, proposer, parameter, new_value, status, created_ledger, updated_ledger)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (proposal_id) DO UPDATE SET
        proposer = EXCLUDED.proposer,
        parameter = EXCLUDED.parameter,
        new_value = EXCLUDED.new_value,
        status = EXCLUDED.status,
        updated_ledger = EXCLUDED.updated_ledger
      `,
      [
        proposal.proposal_id.toString(),
        proposal.proposer,
        proposal.parameter,
        proposal.new_value.toString(),
        proposal.status,
        proposal.created_ledger,
        proposal.updated_ledger,
      ]
    );
  }

  // ───────────────────────────────── Reports ───────────────────────────────────

  async insertReport(report: import("./db").Report): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO reports (post_id, reporter_address, reason, status)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (post_id, reporter_address) WHERE status = 'pending' DO NOTHING
      `,
      [
        report.post_id.toString(),
        report.reporter_address,
        report.reason,
        report.status || "pending",
      ]
    );
  }

  async updateGovernanceProposalStatus(
    proposal_id: bigint,
    status: string,
    ledger: number
  ): Promise<void> {
    await this.pool.query(
      `
      UPDATE governance_proposals
      SET status = $1, updated_ledger = $2
      WHERE proposal_id = $3
      `,
      [status, ledger, proposal_id.toString()]
    );
  }

  async insertGovernanceVote(vote: GovernanceVote): Promise<boolean> {
    const res = await this.pool.query(
      `
      INSERT INTO governance_votes (proposal_id, voter, support, ledger)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (proposal_id, voter) DO NOTHING
      RETURNING proposal_id
      `,
      [vote.proposal_id.toString(), vote.voter, vote.support, vote.ledger]
    );

    const inserted = (res.rowCount ?? 0) > 0;
    if (inserted) {
      if (vote.support) {
        await this.pool.query(
          `
          UPDATE governance_proposals
          SET votes_for = votes_for + 1, updated_ledger = $1
          WHERE proposal_id = $2
          `,
          [vote.ledger, vote.proposal_id.toString()]
        );
      } else {
        await this.pool.query(
          `
          UPDATE governance_proposals
          SET votes_against = votes_against + 1, updated_ledger = $1
          WHERE proposal_id = $2
          `,
          [vote.ledger, vote.proposal_id.toString()]
        );
      }
    }
    return inserted;
  }

  async listGovernanceProposals(filters: {
    limit: number;
    offset: number;
  }): Promise<{ proposals: GovernanceProposal[]; total: number }> {
    const { limit, offset } = filters;
    const totalRes = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM governance_proposals`
    );
    const total = totalRes.rows[0]?.total ?? 0;

    const res = await this.pool.query(
      `
      SELECT proposal_id, proposer, parameter, new_value, votes_for, votes_against, status, created_ledger, updated_ledger
      FROM governance_proposals
      ORDER BY proposal_id DESC
      OFFSET $1 LIMIT $2
      `,
      [offset, limit]
    );

    const proposals: GovernanceProposal[] = res.rows.map((row) => ({
      proposal_id: BigInt(row.proposal_id),
      proposer: row.proposer,
      parameter: row.parameter,
      new_value: BigInt(row.new_value),
      votes_for: BigInt(row.votes_for),
      votes_against: BigInt(row.votes_against),
      status: row.status,
      created_ledger: row.created_ledger,
      updated_ledger: row.updated_ledger,
    }));

    return { proposals, total };
  }

  async updateReportStatus(
    post_id: bigint,
    reporter_address: string,
    status: "dismissed" | "action_taken",
    moderator_address?: string,
    moderator_notes?: string
  ): Promise<void> {
    const query = `
      UPDATE reports
      SET status = $1,
          moderator_address = $2,
          moderator_notes = $3
      WHERE post_id = $4 AND reporter_address = $5 AND status = 'pending'
    `;

    await this.pool.query(query, [
      status,
      moderator_address || null,
      moderator_notes || null,
      post_id.toString(),
      reporter_address,
    ]);
  }

  async getPostReports(post_id: bigint): Promise<import("./db").Report[]> {
    const res = await this.pool.query(
      `
      SELECT
        id,
        post_id,
        reporter_address,
        reason,
        status,
        moderator_address,
        moderator_notes,
        created_at,
        updated_at
      FROM reports
      WHERE post_id = $1
      ORDER BY created_at DESC
      `,
      [post_id.toString()]
    );

    return res.rows.map((row) => ({
      id: row.id,
      post_id: BigInt(row.post_id),
      reporter_address: row.reporter_address,
      reason: row.reason,
      status: row.status,
      moderator_address: row.moderator_address,
      moderator_notes: row.moderator_notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  // ───────────────────────────────── Blocks ───────────────────────────────────

  async insertBlock(block: { blocker: string; blocked: string }): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO blocks (blocker, blocked)
      VALUES ($1, $2)
      ON CONFLICT (blocker, blocked) DO NOTHING
      `,
      [block.blocker, block.blocked]
    );
  }

  async deleteBlock(blocker: string, blocked: string): Promise<void> {
    await this.pool.query(
      `
      DELETE FROM blocks
      WHERE blocker = $1 AND blocked = $2
      `,
      [blocker, blocked]
    );
  }

  async getBlockedUsers(
    address: string,
    limit: number,
    offset: number
  ): Promise<{ blocked: string[]; total: number }> {
    const totalRes = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM blocks WHERE blocker = $1`,
      [address]
    );
    const total = totalRes.rows[0]?.total ?? 0;

    const res = await this.pool.query(
      `
      SELECT blocked
      FROM blocks
      WHERE blocker = $1
      ORDER BY blocked ASC
      OFFSET $2 LIMIT $3
      `,
      [address, offset, limit]
    );

    return { blocked: res.rows.map((r) => r.blocked as string), total };
  }

  // ───────────────────────────────── DM Keys ──────────────────────────────────

  async upsertDmKey(dmKey: { address: string; x25519_pubkey: string }): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO dm_keys (address, x25519_pubkey, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (address)
      DO UPDATE SET
        x25519_pubkey = EXCLUDED.x25519_pubkey,
        updated_at = EXCLUDED.updated_at
      `,
      [dmKey.address, dmKey.x25519_pubkey]
    );
  }

  async getDmKey(address: string): Promise<string | null> {
    const res = await this.pool.query(
      `
      SELECT x25519_pubkey
      FROM dm_keys
      WHERE address = $1
      `,
      [address]
    );
    return res.rows[0]?.x25519_pubkey ?? null;
  }
}
