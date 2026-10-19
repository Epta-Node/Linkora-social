/**
 * Amount validation and error messages for tipping (issue #1633).
 *
 * Amounts are compared in the token's base units with BigInt, so a balance of
 * 10.0000001 is never rounded into accepting 10.0000002.
 */

import { classifyError } from "@/hooks/usePoolContract";

/** Classic Stellar assets (and their SAC wrappers) use 7 decimal places. */
export const CLASSIC_ASSET_DECIMALS = 7;

/** `linkora_contracts::Error::TipCooldownActive` (errors.rs). */
export const TIP_COOLDOWN_ERROR_CODE = 126;

const AMOUNT_RE = /^\d+(\.\d+)?$/;

/** "12.5000000" → "12.5"; integers are left untouched. */
export function trimAmount(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

/** Parses a decimal string into base units; returns null if it is not a plain non-negative number. */
export function toBaseUnits(value: string, decimals: number): bigint | null {
  const trimmed = value.trim();
  if (!AMOUNT_RE.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) return null;
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

export interface TipAmountContext {
  /** Spendable balance as a decimal string (Horizon format, e.g. "12.5000000"). */
  balance: string;
  decimals: number;
  symbol: string;
}

/**
 * Validates a tip amount against the selected token. Returns an error message
 * for display next to the input, or null when the amount can be submitted.
 */
export function validateTipAmount(value: string, token: TipAmountContext | null): string | null {
  if (!token) return "Select a token to tip with.";
  if (value.trim() === "") return "Enter an amount.";
  if (!AMOUNT_RE.test(value.trim())) return "Enter a valid number.";
  const fraction = value.trim().split(".")[1] ?? "";
  if (fraction.length > token.decimals) {
    return `${token.symbol} supports at most ${token.decimals} decimal places.`;
  }
  const amount = toBaseUnits(value, token.decimals);
  if (amount === null || amount <= 0n) return "Amount must be greater than 0.";
  const balance = toBaseUnits(token.balance, token.decimals) ?? 0n;
  if (amount > balance) {
    return `Insufficient balance — you have ${trimAmount(token.balance)} ${token.symbol}.`;
  }
  return null;
}

/**
 * Human-readable tip error. The tip cooldown (`TIP_CD_W`, enforced per tipper,
 * post and token) surfaces from Soroban as `Error(Contract, #126)`.
 */
export function classifyTipError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (
    new RegExp(`Error\\(Contract,\\s*#${TIP_COOLDOWN_ERROR_CODE}\\)`).test(message) ||
    /TipCooldownActive|TIP_CD_W|cooldown/i.test(message)
  ) {
    return "You tipped this post with this token recently. Each token can tip a post once per cooldown window (about a day) — try again later or pick a different token.";
  }
  return classifyError(err);
}
