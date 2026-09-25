import { StrKey } from "@stellar/stellar-base";
import { InvalidInputError, ValidationError } from "./errors.js";

/**
 * Centralized Stellar address validation for every LinkoraClient method
 * (issue #1345).
 *
 * - {@link isAccountAddress} — Ed25519 account public keys (`G…`).
 * - {@link isContractAddress} — Soroban contract addresses (`C…`).
 * - {@link isStellarAddress} — either of the two.
 *
 * Identity parameters (`user`, `author`, `follower`, …) accept either form:
 * the Soroban `Address` type the contracts store covers both. Token
 * parameters (`token`, `creatorToken`) must be contract addresses — SEP-41
 * tokens are Soroban contracts — so account keys are rejected up front by
 * {@link ensureContractAddress} instead of failing later inside the token
 * client.
 */

/** True when `value` is a Stellar account public key (`G…`). */
export function isAccountAddress(value: string): boolean {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }
  try {
    return StrKey.isValidEd25519PublicKey(value);
  } catch {
    return false;
  }
}

/** True when `value` is a Soroban contract address (`C…`). */
export function isContractAddress(value: string): boolean {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }
  try {
    return StrKey.isValidContract(value);
  } catch {
    return false;
  }
}

/** True when `value` is either an account public key or a contract address. */
export function isStellarAddress(value: string): boolean {
  return isAccountAddress(value) || isContractAddress(value);
}

export function ensureNonEmptyString(value: string, fieldName: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidInputError(`${fieldName} must be a non-empty string.`);
  }
}

/**
 * Accepts either a Stellar account public key (`G…`) or a Soroban contract
 * address (`C…`).
 */
export function ensureAddress(value: string, fieldName: string): void {
  ensureNonEmptyString(value, fieldName);
  if (!isStellarAddress(value)) {
    throw new InvalidInputError(
      `${fieldName} must be a valid Stellar public key or contract address.`
    );
  }
}

/** Only accepts a Stellar account public key (`G…`). */
export function ensureAccountAddress(value: string, fieldName: string): void {
  ensureNonEmptyString(value, fieldName);
  if (!isAccountAddress(value)) {
    throw new InvalidInputError(
      `${fieldName} must be a valid Stellar account public key (G...).`
    );
  }
}

/** Only accepts a Soroban contract address (`C…`). */
export function ensureContractAddress(value: string, fieldName: string): void {
  ensureNonEmptyString(value, fieldName);
  if (!isContractAddress(value)) {
    throw new InvalidInputError(
      `${fieldName} must be a valid Soroban contract address (C...).`
    );
  }
}

/** Accepts an array where every element is an account key or contract address. */
export function ensureAddressList(values: string[], fieldName: string): void {
  if (!Array.isArray(values)) {
    throw new ValidationError(`${fieldName} must be an array of Stellar public keys.`);
  }
  values.forEach((value, index) => ensureAddress(value, `${fieldName}[${index}]`));
}
