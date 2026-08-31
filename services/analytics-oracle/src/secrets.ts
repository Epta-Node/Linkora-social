/**
 * Keystore abstraction for loading the oracle Ed25519 signing key.
 *
 * Supports two backends, selected via the `SECRETS` env var:
 *
 *   SECRETS=file:///path/to/oracle-key.hex
 *     Reads the hex-encoded key from a file (Docker secret, K8s secret volume,
 *     AWS Secrets Manager mounted via the AWS Secrets & Config Provider, etc.).
 *
 *   SECRETS=env:ORACLE_PRIVATE_KEY_HEX    (default)
 *     Reads from the named environment variable. This is the legacy mode and
 *     should NOT be used in production — it exists only for local development
 *     and backwards compatibility.
 *
 * The file path can use a `file://` prefix (optional) or be treated as a raw
 * path. Trailing newlines and whitespace are stripped automatically.
 *
 * After constructing the `Keypair` object the caller **must** call
 * `zeroise()` to overwrite the raw key bytes on the V8 heap.
 */

import { readFileSync } from "fs";
import { logger } from "./logger.js";

export interface Keystore {
  /** Load the current signing key material. Returns the raw 32-byte seed. */
  loadSeed(): Uint8Array;
  /** Overwrite the in-memory key buffer with zeros. */
  zeroise(): void;
  /** Polling interval in ms (0 = no polling / file-watch not supported). */
  pollIntervalMs: number;
  /** Human-readable source description for logging. */
  source: string;
  /** Reload the key from the backend (for hot rotation via the admin API). */
  reload(): Uint8Array;
}

export function createKeystore(): Keystore {
  const raw = process.env["SECRETS"] ?? "env:ORACLE_PRIVATE_KEY_HEX";
  const source = raw.trim();

  if (source.startsWith("file:")) {
    const filePath = source.slice("file://".length).trim();
    return fileKeystore(filePath);
  }

  // Default: read from the named env var.
  const envName = source.startsWith("env:") ? source.slice("env:".length).trim() : source;
  return envKeystore(envName);
}

// ── File backend ──────────────────────────────────────────────────────────────

function fileKeystore(filePath: string): Keystore {
  let currentSeed: Uint8Array | null = null;

  function readSeed(): Uint8Array {
    const hex = readFileSync(filePath, "utf8").trim();
    const seed = Buffer.from(hex, "hex");
    if (seed.length !== 32) {
      throw new Error(`Oracle key file ${filePath}: expected 32 bytes, got ${seed.length}`);
    }
    return seed;
  }

  return {
    get source() {
      return `file:${filePath}`;
    },
    pollIntervalMs: 0,
    loadSeed() {
      if (!currentSeed) currentSeed = readSeed();
      return currentSeed;
    },
    reload() {
      zeroiseSeed(currentSeed);
      currentSeed = readSeed();
      logger.info({ source: `file:${filePath}` }, "Keystore reloaded from file");
      return currentSeed;
    },
    zeroise() {
      zeroiseSeed(currentSeed);
      currentSeed = null;
    },
  };
}

// ── Env-var backend (legacy / dev) ────────────────────────────────────────────

function envKeystore(envName: string): Keystore {
  let currentSeed: Uint8Array | null = null;

  function readSeed(): Uint8Array {
    const hex = process.env[envName];
    if (!hex) throw new Error(`Missing env: ${envName}`);
    const seed = Buffer.from(hex.trim(), "hex");
    if (seed.length !== 32) {
      throw new Error(`Env ${envName}: expected 32-byte hex key, got ${seed.length} bytes`);
    }
    return seed;
  }

  return {
    get source() {
      return `env:${envName}`;
    },
    pollIntervalMs: 0,
    loadSeed() {
      if (!currentSeed) currentSeed = readSeed();
      return currentSeed;
    },
    reload() {
      zeroiseSeed(currentSeed);
      currentSeed = readSeed();
      logger.info({ source: `env:${envName}` }, "Keystore reloaded from env");
      return currentSeed;
    },
    zeroise() {
      zeroiseSeed(currentSeed);
      currentSeed = null;
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function zeroiseSeed(seed: Uint8Array | null): void {
  if (!seed) return;
  seed.fill(0);
}
