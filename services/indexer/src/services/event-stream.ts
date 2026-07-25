/**
 * Re-exports streaming primitives used by the backfill coordinator and other
 * services, keeping them co-located under services/ without duplicating the
 * core implementation in src/stream.ts.
 *
 * The canonical implementations live in ../stream. This module exposes only
 * the types needed by services in this directory.
 */
export type { RawEvent, BatchProcessor, BackfillState } from "../stream";
export { getBackfillState } from "../stream";
