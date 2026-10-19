/**
 * UTF-8 byte-count helpers.
 *
 * The Soroban smart contract enforces post length using `String::len()` in Rust,
 * which is the UTF-8 byte count (not JS `String.length`, which is UTF-16 code units).
 * Use `utf8Bytes` anywhere the frontend needs to mirror on-chain limits.
 */

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}
