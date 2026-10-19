/**
 * Minimal in-memory stand-in for the subset of expo-sqlite's async API that
 * `utils/db.ts` actually issues. It isn't a general SQL engine — each branch
 * pattern-matches the exact statements db.ts sends — but it faithfully
 * reproduces their semantics (upsert-by-id, MAX-based monotonic columns,
 * conditional deletes) so tests exercise the real merge/reconciliation logic
 * in db.ts rather than a re-description of it.
 */

import type * as SQLite from "expo-sqlite";

type Row = Record<string, unknown>;
type BindParams = SQLite.SQLiteBindParams;

export function createFakeDb() {
  const dmMessages = new Map<string, Row>();
  const dmSyncState = new Map<string, { sync_cursor: number; last_read: number }>();
  const cachedPosts = new Map<string, Row>();
  let userVersion = 0;

  return {
    __state: {
      dmMessages,
      dmSyncState,
      cachedPosts,
      get userVersion() {
        return userVersion;
      },
    },

    execAsync: jest.fn(async (sql: string) => {
      const versionMatch = sql.match(/PRAGMA user_version\s*=\s*(\d+)/);
      if (versionMatch) {
        userVersion = Number(versionMatch[1]);
        return;
      }

      // Models `ALTER TABLE cached_posts ADD COLUMN <name> <type> [DEFAULT <default>]`
      // for the migration test (#1560) — applies the new column, with its
      // default, to every already-cached row.
      const addColumnMatch = sql.match(
        /ALTER TABLE cached_posts ADD COLUMN (\w+) \w+(?: NOT NULL)? DEFAULT ([^;\s]+)/
      );
      if (addColumnMatch) {
        const [, column, rawDefault] = addColumnMatch;
        const defaultValue = /^-?\d+$/.test(rawDefault) ? Number(rawDefault) : rawDefault;
        for (const row of cachedPosts.values()) {
          row[column] = defaultValue;
        }
        return;
      }

      // CREATE TABLE / CREATE INDEX bootstrap statements: this fake models
      // tables as plain Maps, so there's no real schema to create.
    }),

    withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => {
      await fn();
    }),

    runAsync: jest.fn(async (sql: string, params: BindParams = []) => {
      // Normalise both array-style and object-style params to a plain array
      // for the pattern-matched logic below. The fake only receives positional
      // (array) params from db.ts, so this cast is safe for our use-cases.
      const p: unknown[] = Array.isArray(params) ? params : Object.values(params);
      if (sql.includes("INSERT INTO cached_posts") && sql.includes("ON CONFLICT(id) DO UPDATE")) {
        // Multi-row upsert: p arrive in chunks of 9 —
        // (id, author, username, content, tip_total, timestamp, like_count, has_liked, created_at).
        for (let i = 0; i < p.length; i += 9) {
          const [
            id,
            author,
            username,
            content,
            tip_total,
            timestamp,
            like_count,
            has_liked,
            created_at,
          ] = p.slice(i, i + 9) as [
            string,
            string,
            string,
            string,
            number,
            number,
            number,
            number,
            number,
          ];
          const existing = cachedPosts.get(id);
          cachedPosts.set(id, {
            id,
            author,
            username,
            content,
            tip_total,
            timestamp,
            like_count,
            has_liked,
            sync_status: "synced",
            created_at: existing ? existing.created_at : created_at,
          });
        }
        return;
      }

      if (sql.includes("INSERT INTO cached_posts") && sql.includes("'pending'")) {
        const [id, author, username, content, timestamp, created_at] = p as [
          string,
          string,
          string,
          string,
          number,
          number,
        ];
        cachedPosts.set(id, {
          id,
          author,
          username,
          content,
          tip_total: 0,
          timestamp,
          like_count: 0,
          has_liked: 0,
          sync_status: "pending",
          created_at,
        });
        return;
      }

      // A plain single-row 'synced' insert (no ON CONFLICT), used by migration
      // tests to seed a row in a specific state.
      if (sql.includes("INSERT INTO cached_posts") && sql.includes("'synced'")) {
        const [id, author, username, content, timestamp, created_at] = p as [
          string,
          string,
          string,
          string,
          number,
          number,
        ];
        cachedPosts.set(id, {
          id,
          author,
          username,
          content,
          tip_total: 0,
          timestamp,
          like_count: 0,
          has_liked: 0,
          sync_status: "synced",
          created_at,
        });
        return;
      }

      if (
        sql.includes("DELETE FROM cached_posts") &&
        sql.includes("sync_status IN ('pending', 'failed')")
      ) {
        // Batched conflict-resolution delete: p arrive in triples of (author, content, id).
        const triples: Array<[string, string, string]> = [];
        for (let i = 0; i < p.length; i += 3) {
          triples.push(p.slice(i, i + 3) as [string, string, string]);
        }
        for (const [key, row] of cachedPosts) {
          if (row.sync_status !== "pending" && row.sync_status !== "failed") continue;
          const matches = triples.some(
            ([author, content, id]) =>
              row.author === author && row.content === content && row.id !== id
          );
          if (matches) cachedPosts.delete(key);
        }
        return;
      }

      // Row-count cap: keep the `LIMIT ?` newest synced rows by timestamp.
      if (sql.includes("DELETE FROM cached_posts") && /ORDER\s+BY\s+timestamp\s+DESC/.test(sql)) {
        const [maxRows] = p as [number];
        const synced = Array.from(cachedPosts.entries())
          .filter(([, row]) => row.sync_status === "synced")
          .sort((a, b) => Number(b[1].timestamp) - Number(a[1].timestamp));
        for (const [key] of synced.slice(maxRows)) {
          cachedPosts.delete(key);
        }
        return;
      }

      if (
        sql.includes("DELETE FROM cached_posts") &&
        /\bsync_status\s*=\s*'synced'\s+AND\s+id\s+NOT\s+IN\b/.test(sql)
      ) {
        const keepIds = new Set(p as string[]);
        for (const [key, row] of cachedPosts) {
          if (row.sync_status === "synced" && !keepIds.has(row.id as string)) {
            cachedPosts.delete(key);
          }
        }
        return;
      }

      if (sql.includes("UPDATE cached_posts SET sync_status = 'failed'")) {
        const [id] = p as [string];
        const row = cachedPosts.get(id);
        if (row) row.sync_status = "failed";
        return;
      }

      // Repair migration (#1543): rows whose `timestamp` column holds a Stellar
      // ledger sequence are restored to the real wall-clock second they were
      // synced at.
      if (sql.includes("UPDATE cached_posts SET timestamp = created_at WHERE timestamp <")) {
        const [threshold] = p as [number];
        for (const row of cachedPosts.values()) {
          if (Number(row.timestamp) < threshold) row.timestamp = row.created_at;
        }
        return;
      }

      if (
        sql.includes("DELETE FROM cached_posts") &&
        /\bsync_status\s*=\s*'synced'\s+AND\s+timestamp\s*</.test(sql)
      ) {
        const [cutoff] = p as [number];
        for (const [key, row] of cachedPosts) {
          if (row.sync_status === "synced" && Number(row.timestamp) < cutoff) {
            cachedPosts.delete(key);
          }
        }
        return;
      }

      if (sql.includes("UPDATE cached_posts SET id = ?")) {
        const [realId, localId] = p as [string, string];
        const row = cachedPosts.get(localId);
        if (row) {
          cachedPosts.delete(localId);
          cachedPosts.set(realId, { ...row, id: realId, sync_status: "synced" });
        }
        return;
      }

      if (sql.includes("DELETE FROM cached_posts WHERE id = ?")) {
        const [id] = p as [string];
        cachedPosts.delete(id);
        return;
      }

      if (sql.includes("INSERT INTO dm_messages") && sql.includes("ON CONFLICT(id) DO UPDATE")) {
        const [
          id,
          conversation_id,
          sender,
          recipient,
          content,
          ciphertext_hash,
          timestamp,
          created_at,
        ] = p as [string, string, string, string, string, string, number, number];
        const existing = dmMessages.get(id);
        dmMessages.set(id, {
          id,
          conversation_id,
          sender,
          recipient,
          content,
          ciphertext_hash,
          timestamp,
          sync_status: "synced",
          error_message: null,
          created_at: existing ? existing.created_at : created_at,
        });
        return;
      }

      if (sql.includes("INSERT INTO dm_messages") && sql.includes("'pending'")) {
        const [
          id,
          conversation_id,
          sender,
          recipient,
          content,
          ciphertext_hash,
          timestamp,
          created_at,
        ] = p as [string, string, string, string, string, string, number, number];
        dmMessages.set(id, {
          id,
          conversation_id,
          sender,
          recipient,
          content,
          ciphertext_hash,
          timestamp,
          sync_status: "pending",
          error_message: null,
          created_at,
        });
        return;
      }

      if (sql.includes("DELETE FROM dm_messages") && sql.includes("ciphertext_hash = ?")) {
        const [conversation_id, ciphertext_hash, id] = p as [string, string, string];
        for (const [key, row] of dmMessages) {
          if (
            row.conversation_id === conversation_id &&
            (row.sync_status === "pending" || row.sync_status === "failed") &&
            row.ciphertext_hash === ciphertext_hash &&
            row.id !== id
          ) {
            dmMessages.delete(key);
          }
        }
        return;
      }

      if (sql.includes("UPDATE dm_messages SET sync_status = 'failed'")) {
        const [error_message, id] = p as [string, string];
        const row = dmMessages.get(id);
        if (row) {
          row.sync_status = "failed";
          row.error_message = error_message;
        }
        return;
      }

      if (sql.includes("INSERT INTO dm_sync_state") && sql.includes("sync_cursor = MAX")) {
        const [conversation_id, cursor] = p as [string, number];
        const existing = dmSyncState.get(conversation_id) ?? { sync_cursor: 0, last_read: 0 };
        dmSyncState.set(conversation_id, {
          sync_cursor: Math.max(existing.sync_cursor, cursor),
          last_read: existing.last_read,
        });
        return;
      }

      if (sql.includes("INSERT INTO dm_sync_state") && sql.includes("last_read = MAX")) {
        const [conversation_id, timestamp] = p as [string, number];
        const existing = dmSyncState.get(conversation_id) ?? { sync_cursor: 0, last_read: 0 };
        dmSyncState.set(conversation_id, {
          sync_cursor: existing.sync_cursor,
          last_read: Math.max(existing.last_read, timestamp),
        });
        return;
      }

      throw new Error(`sqliteFake: unhandled runAsync statement: ${sql}`);
    }),

    getAllAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM cached_posts WHERE id IN")) {
        const ids = new Set(params as string[]);
        return Array.from(cachedPosts.values()).filter((row) => ids.has(row.id as string));
      }
      if (
        sql.includes("FROM cached_posts") &&
        sql.includes("sync_status = 'pending' OR sync_status = 'failed'")
      ) {
        return Array.from(cachedPosts.values()).filter(
          (row) => row.sync_status === "pending" || row.sync_status === "failed"
        );
      }
      if (sql.includes("FROM cached_posts")) {
        return Array.from(cachedPosts.values()).sort(
          (a, b) => (b.timestamp as number) - (a.timestamp as number)
        );
      }
      if (sql.includes("FROM dm_messages WHERE conversation_id = ?")) {
        const [conversation_id] = params as [string];
        return Array.from(dmMessages.values())
          .filter((row) => row.conversation_id === conversation_id)
          .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));
      }
      throw new Error(`sqliteFake: unhandled getAllAsync statement: ${sql}`);
    }),

    getFirstAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("PRAGMA user_version")) {
        return { user_version: userVersion };
      }
      if (sql.includes("FROM cached_posts WHERE id = ?")) {
        const [id] = params as [string];
        return cachedPosts.get(id) ?? null;
      }
      if (sql.includes("MAX(timestamp)") && sql.includes("FROM cached_posts")) {
        const timestamps = Array.from(cachedPosts.values())
          .filter((row) => row.sync_status === "synced")
          .map((row) => Number(row.timestamp));
        return { max_ts: timestamps.length > 0 ? Math.max(...timestamps) : null };
      }
      const [conversation_id] = params as [string];
      const state = dmSyncState.get(conversation_id);
      if (sql.includes("SELECT sync_cursor")) {
        return state ? { sync_cursor: state.sync_cursor } : null;
      }
      if (sql.includes("SELECT last_read")) {
        return state ? { last_read: state.last_read } : null;
      }
      throw new Error(`sqliteFake: unhandled getFirstAsync statement: ${sql}`);
    }),
  };
}
