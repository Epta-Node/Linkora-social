/**
 * Composite keyset cursors for feed/explore pagination (issue #1329).
 *
 * A single sort column (`created_at` or `score`) is not unique: multiple
 * posts can share it, especially ones ingested in the same ledger. Paginating
 * with `column < cursor` alone drops or repeats rows across a tie: the last
 * page's boundary value reappears on (or vanishes from) the next page
 * depending on ordering. The fix is a composite key `(column, id)`, compared
 * as a tuple (`(column, id) < (cursor_column, cursor_id)`), which is strictly
 * ordered because `id` is unique. See `postgres-db.ts` / `dm-relay` for the
 * same pattern applied to message pagination (#1529).
 *
 * The cursor is opaque to the client: `base64("value|id")`.
 */

/** Encodes a composite cursor. `value` is the sort column's value as a string. */
export function encodeCursor(value: string, id: string): string {
  return Buffer.from(`${value}|${id}`, "utf-8").toString("base64");
}

/** Decodes a composite cursor, or returns `null` for anything malformed. */
export function decodeCursor(cursor: string): { value: string; id: string } | null {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64").toString("utf-8");
  } catch {
    return null;
  }
  const sep = decoded.lastIndexOf("|");
  if (sep <= 0 || sep === decoded.length - 1) return null;
  const value = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  if (!value || !id) return null;
  return { value, id };
}

/** Decodes a cursor whose sort column is a number (`score`). */
export function decodeNumericCursor(cursor: string): { value: number; id: string } | null {
  const parsed = decodeCursor(cursor);
  if (!parsed) return null;
  const value = Number(parsed.value);
  if (!Number.isFinite(value)) return null;
  return { value, id: parsed.id };
}

/** Decodes a cursor whose sort column is a timestamp (`created_at`). */
export function decodeTimestampCursor(cursor: string): { value: Date; id: string } | null {
  const parsed = decodeCursor(cursor);
  if (!parsed) return null;
  const value = new Date(parsed.value);
  if (Number.isNaN(value.getTime())) return null;
  return { value, id: parsed.id };
}
