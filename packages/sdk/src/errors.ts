/**
 * Base class for all Linkora SDK errors.
 */
export class LinkoraError extends Error {
  constructor(
    message: string,
    public readonly code: string = "LINKORA_ERROR",
    public readonly details?: Record<string, unknown>,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    // Set prototype explicitly to support instanceof checks in compiled environments.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a requested resource (e.g. post, pool, or profile) does not exist on-chain.
 */
export class NotFoundError extends LinkoraError {
  constructor(message: string, details?: Record<string, unknown>, originalError?: unknown) {
    super(message, "NOT_FOUND", details, originalError);
  }
}

/**
 * Thrown when the caller is unauthorized (e.g., trying to modify another user's post,
 * pool withdraw without being a pool admin, or trying to interact with a blocker).
 */
export class UnauthorizedError extends LinkoraError {
  constructor(message: string, details?: Record<string, unknown>, originalError?: unknown) {
    super(message, "UNAUTHORIZED", details, originalError);
  }
}

/**
 * Thrown when the caller has insufficient funds or insufficient token allowance for operations.
 */
export class InsufficientBalanceError extends LinkoraError {
  constructor(message: string, details?: Record<string, unknown>, originalError?: unknown) {
    super(message, "INSUFFICIENT_BALANCE", details, originalError);
  }
}

/**
 * Thrown when the tipping cooldown window is active.
 */
export class CooldownError extends LinkoraError {
  constructor(message: string, details?: Record<string, unknown>, originalError?: unknown) {
    super(message, "COOLDOWN_ACTIVE", details, originalError);
  }
}

/**
 * Thrown when a mini-app manifest fails JSON schema validation.
 */
export class InvalidManifestError extends LinkoraError {
  constructor(message: string, details?: Record<string, unknown>, originalError?: unknown) {
    super(message, "INVALID_MANIFEST", details, originalError);
  }
}

/**
 * Thrown when transaction simulation fails. Contains the full diagnostic event log.
 */
export class SimulationError extends LinkoraError {
  public error?: string;
  public hostError?: string;

  constructor(
    message: string,
    public readonly eventLog?: unknown,
    originalError?: unknown,
    error?: string,
    hostError?: string
  ) {
    super(message, "SIMULATION_FAILED", undefined, originalError);
    this.error = error;
    this.hostError = hostError;
  }
}

// ── New typed error classes (issue #785) ──────────────────────────────────────

/**
 * Thrown when input validation fails before any on-chain interaction.
 * Carries a machine-readable `code` and an optional `details` map
 * (e.g. `{ field: "username", constraint: "max_length" }`).
 */
export class ValidationError extends LinkoraError {
  constructor(message: string, details?: Record<string, unknown>, originalError?: unknown) {
    super(message, "VALIDATION_ERROR", details, originalError);
  }
}

/**
 * @deprecated Use ValidationError instead. Kept as an alias for backward compatibility.
 */
export class InvalidInputError extends ValidationError {
  constructor(message: string, details?: Record<string, unknown>, originalError?: unknown) {
    super(message, details, originalError);
    // Override the hardcoded VALIDATION_ERROR code while preserving the prototype chain
    (this as unknown as { code: string }).code = "INVALID_INPUT";
  }
}

/**
 * Thrown on RPC / network-level failures (connection refused, timeout, non-200
 * HTTP responses from Soroban RPC, Horizon, or the relay).
 */
export class NetworkError extends LinkoraError {
  constructor(message: string, details?: Record<string, unknown>, originalError?: unknown) {
    super(message, "NETWORK_ERROR", details, originalError);
  }
}

/**
 * Thrown when a wallet or hardware signer fails to produce a valid signature
 * (extension not found, user rejected, device disconnected, etc.).
 */
export class SigningError extends LinkoraError {
  constructor(message: string, details?: Record<string, unknown>, originalError?: unknown) {
    super(message, "SIGNING_ERROR", details, originalError);
  }
}

/**
 * Thrown when an HTTP request exceeds the configured timeout.
 */
export class TimeoutError extends LinkoraError {
  constructor(message: string, details?: Record<string, unknown>, originalError?: unknown) {
    super(message, "TIMEOUT", details, originalError);
  }
}

/**
 * Raised when every bounded retry attempt for an idempotent request has
 * failed (issue #1363). Carries the number of attempts made and the final
 * transport error as `originalError`.
 */
export class RetryExhaustedError extends LinkoraError {
  constructor(message: string, details?: Record<string, unknown>, originalError?: unknown) {
    super(message, "RETRY_EXHAUSTED", details, originalError);
  }
}

/**
 * Thrown when an on-chain contract invocation fails (simulation error, contract
 * FAILED status, or a diagnostic trap returned by Soroban).
 */
export class ContractError extends LinkoraError {
  constructor(message: string, details?: Record<string, unknown>, originalError?: unknown) {
    super(message, "CONTRACT_ERROR", details, originalError);
  }
}

/**
 * Thrown when the retry circuit breaker opens after too many consecutive
 * retryable failures. Signals that the transaction queue has been paused and
 * the RPC endpoint should be treated as unhealthy until it recovers.
 */
export class CircuitBreakerError extends LinkoraError {
  constructor(message: string, details?: Record<string, unknown>, originalError?: unknown) {
    super(message, "CIRCUIT_OPEN", details, originalError);
  }
}

/**
 * Thrown when the deployed contract version or capability marker does not match SDK expectation.
 */
export class VersionMismatchError extends LinkoraError {
  constructor(message: string, details?: Record<string, unknown>, originalError?: unknown) {
    super(message, "VERSION_MISMATCH", details, originalError);
  }
}

/**
 * Discriminated result type for on-chain read operations.
 * Callers can explicitly distinguish valid data, genuinely empty/absent data, and errors.
 */
export type ReadResult<T> =
  | { ok: true; value: T; absent?: false }
  | { ok: true; value: null; absent: true }
  | { ok: false; error: LinkoraError };


// ── Contract error codes ──────────────────────────────────────────────────────
//
// These numeric codes are the `#[repr(u32)]` discriminants of the on-chain
// `ContractError` enum in `src/errors.rs`.  Any new variant added there
// **must** be reflected here so that typed SDK errors surface to callers
// instead of the generic `ContractError` fallback.
//
// Codes 100–143 match the Rust enum exactly (issue #1679).

export enum ContractErrorCode {
  AlreadyInitialized = 100,
  NotInitialized = 101,
  UsernameTaken = 102,
  UsernameTooShort = 103,
  UsernameTooLong = 104,
  ContentTooLong = 105,
  ContentEmpty = 106,
  Blocked = 107,
  NotBlocked = 108,
  Unauthorized = 109,
  PostNotFound = 110,
  ProfileNotFound = 111,
  PoolNotFound = 112,
  PoolExists = 113,
  InvalidThreshold = 114,
  /** Fewer valid signers than the pool's M-of-N threshold requires. */
  InsufficientSigners = 115,
  /** A signer address is not a member of the pool's admin set. */
  UnauthorizedSigner = 116,
  LowBalance = 117,
  WrongToken = 118,
  AlreadyPaused = 119,
  NotPaused = 120,
  ContractPaused = 121,
  AlreadyFollowing = 122,
  NotFollowing = 123,
  SelfInteractionNotAllowed = 124,
  InvalidAmount = 125,
  /** The per-tipper tip cooldown window is still active. */
  TipCooldownActive = 126,
  InvalidCooldown = 127,
  GraphEntryExpired = 128,
  /** Caller does not hold the role required for this entry-point. */
  UnauthorizedRole = 129,
  PoolAdminNotFound = 130,
  PoolAdminExists = 131,
  ProposalNotFound = 132,
  /** The proposal's vote window has closed; it can no longer be acted on. */
  ProposalExpired = 133,
  TimeLockNotExpired = 134,
  QuorumNotMet = 135,
  AlreadyVoted = 136,
  ReportNotFound = 137,
  InvalidVerdict = 138,
  InvalidPostId = 139,
  ZeroAddress = 140,
  CannotRemoveLastAdmin = 141,
  CannotRemoveLastUpgrader = 142,
  MathOverflow = 143,
}

type ErrorConstructor = new (
  message: string,
  details?: Record<string, unknown>,
  originalError?: unknown
) => LinkoraError;

const errorCodeRegistry: Map<ContractErrorCode, ErrorConstructor> = new Map([
  [ContractErrorCode.AlreadyInitialized, ContractError],
  [ContractErrorCode.NotInitialized, ContractError],
  [ContractErrorCode.UsernameTaken, ValidationError],
  [ContractErrorCode.UsernameTooShort, ValidationError],
  [ContractErrorCode.UsernameTooLong, ValidationError],
  [ContractErrorCode.ContentTooLong, ValidationError],
  [ContractErrorCode.ContentEmpty, ValidationError],
  [ContractErrorCode.Blocked, UnauthorizedError],
  [ContractErrorCode.NotBlocked, ValidationError],
  [ContractErrorCode.Unauthorized, UnauthorizedError],
  [ContractErrorCode.PostNotFound, NotFoundError],
  [ContractErrorCode.ProfileNotFound, NotFoundError],
  [ContractErrorCode.PoolNotFound, NotFoundError],
  [ContractErrorCode.PoolExists, ContractError],
  [ContractErrorCode.InvalidThreshold, ValidationError],
  [ContractErrorCode.InsufficientSigners, UnauthorizedError],
  [ContractErrorCode.UnauthorizedSigner, UnauthorizedError],
  [ContractErrorCode.LowBalance, InsufficientBalanceError],
  [ContractErrorCode.WrongToken, ValidationError],
  [ContractErrorCode.AlreadyPaused, ContractError],
  [ContractErrorCode.NotPaused, ContractError],
  [ContractErrorCode.ContractPaused, ContractError],
  [ContractErrorCode.AlreadyFollowing, ValidationError],
  [ContractErrorCode.NotFollowing, ValidationError],
  [ContractErrorCode.SelfInteractionNotAllowed, ValidationError],
  [ContractErrorCode.InvalidAmount, ValidationError],
  [ContractErrorCode.TipCooldownActive, CooldownError],
  [ContractErrorCode.InvalidCooldown, ValidationError],
  [ContractErrorCode.GraphEntryExpired, ContractError],
  [ContractErrorCode.UnauthorizedRole, UnauthorizedError],
  [ContractErrorCode.PoolAdminNotFound, NotFoundError],
  [ContractErrorCode.PoolAdminExists, ContractError],
  [ContractErrorCode.ProposalNotFound, NotFoundError],
  [ContractErrorCode.ProposalExpired, ContractError],
  [ContractErrorCode.TimeLockNotExpired, ContractError],
  [ContractErrorCode.QuorumNotMet, ContractError],
  [ContractErrorCode.AlreadyVoted, ContractError],
  [ContractErrorCode.ReportNotFound, NotFoundError],
  [ContractErrorCode.InvalidVerdict, ValidationError],
  [ContractErrorCode.InvalidPostId, ValidationError],
  [ContractErrorCode.ZeroAddress, ValidationError],
  [ContractErrorCode.CannotRemoveLastAdmin, UnauthorizedError],
  [ContractErrorCode.CannotRemoveLastUpgrader, UnauthorizedError],
  [ContractErrorCode.MathOverflow, ValidationError],
]);

function tryMapByErrorCode(err: unknown): LinkoraError | null {
  if (typeof err !== "object" || err === null) return null;

  const code = (err as Record<string, unknown>).code;
  if (typeof code !== "number") return null;

  const Ctor = errorCodeRegistry.get(code as ContractErrorCode);
  if (!Ctor) return null;

  const msg = err instanceof Error ? err.message : String(err);
  return new Ctor(msg, undefined, err);
}

// ── Transport / network error detection ───────────────────────────────────

/**
 * Error codes that indicate a transport / connectivity failure. Matches Node's
 * `errno` socket codes (thrown by undici/axios when an RPC or Horizon endpoint
 * is unreachable or times out) and the browser `fetch` error codes. These are
 * surfaced as the `code` property on `AxiosError` / `TypeError` instances that
 * `@stellar/stellar-sdk` propagates verbatim when the network is unavailable.
 */
const NETWORK_ERROR_CODE =
  /^(?:ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ENETDOWN|ENETUNREACH|EHOSTUNREACH|EADDRINUSE|EADDRNOTAVAIL|EPIPE|EPROTO|ECANCELED|ERR_NETWORK|ERR_HTTP_REQUEST_TIMEOUT|ERR_ABORTED)(?:\s|$)/i;

/**
 * Transport-specific markers used to recognize a connectivity failure from the
 * error message (and its `cause` chain) without hijacking unrelated contract,
 * validation or signing messages.
 */
const NETWORK_MESSAGE_PATTERN =
  /ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ENETDOWN|fetch failed|load failed|network error|net::ERR_|unreachable/i;

/**
 * Walk the `cause` chain (Node 16.9+/undici wrap the real socket error as
 * `TypeError: fetch failed → cause: Error: connect ECONNREFUSED …`) so the
 * underlying transport signal is not lost when only the wrapper is inspected.
 */
function collectCauseMessages(err: unknown): string[] {
  const messages: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current && typeof current === "object" && depth < 10; depth += 1) {
    if (current instanceof Error && current.message) {
      messages.push(current.message);
    }
    const next = (current as { cause?: unknown }).cause;
    if (!next || next === current) break;
    current = next;
  }
  return messages;
}

/**
 * Map transport-level failures thrown by `rpc.Server` / http calls when the
 * RPC is unreachable (ECONNREFUSED, timeouts, DNS failures) into a typed
 * {@link NetworkError} so callers of simulate/prepareTransaction can classify
 * them instead of receiving the raw socket error.
 */
function tryMapTransportError(err: unknown): NetworkError | null {
  if (typeof err !== "object" || err === null) return null;

  // String `code` fields (axios `errno` codes, undici/Node socket codes).
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && NETWORK_ERROR_CODE.test(code)) {
    return new NetworkError(
      err instanceof Error ? err.message : code,
      { code, cause: collectCauseMessages(err) } as Record<string, unknown>,
      err
    );
  }

  // Message-only transport signals, searched across the whole `cause` chain.
  const chainMessages = collectCauseMessages(err);
  const text = chainMessages.join("\n");
  if (NETWORK_MESSAGE_PATTERN.test(text)) {
    return new NetworkError(
      err instanceof Error ? err.message : (chainMessages[chainMessages.length - 1] ?? text),
      undefined,
      err
    );
  }

  return null;
}

function mapByRegex(msg: string, err: unknown): LinkoraError {
  if (/allowance|insufficient allowance/i.test(msg)) {
    return new InsufficientBalanceError(
      "Insufficient allowance to complete transaction.",
      undefined,
      err
    );
  }
  if (/balance|low balance|insufficient balance/i.test(msg)) {
    return new InsufficientBalanceError(
      "Insufficient account balance for this transaction.",
      undefined,
      err
    );
  }
  if (/unauthorized|not admin|only admin|only author/i.test(msg)) {
    return new UnauthorizedError(
      "Unauthorized operation. You do not have permission.",
      undefined,
      err
    );
  }
  if (/blocked/i.test(msg)) {
    return new UnauthorizedError("Operation rejected: user has blocked you.", undefined, err);
  }
  if (/overflow|underflow|division by zero|out of bounds/i.test(msg)) {
    return new ValidationError(`Contract math or bounds assertion failed: ${msg}`, { rawMessage: msg }, err);
  }
  if (/assert!|assertion failed/i.test(msg)) {
    return new ValidationError(`Contract assertion failed: ${msg}`, { rawMessage: msg }, err);
  }
  if (/panic!\((?:.*)\)|contract panic|panic/i.test(msg)) {
    return new ContractError(`Contract panic: ${msg}`, { rawMessage: msg, unmapped: false }, err);
  }
  if (/sign|freighter|ledger|wallet/i.test(msg)) {
    return new SigningError(msg, undefined, err);
  }
  if (/not found|does not exist|MissingValue/i.test(msg)) {
    return new NotFoundError("The requested resource was not found.", undefined, err);
  }
  if (/cooldown/i.test(msg)) {
    return new CooldownError("Tipping cooldown has not expired yet.", undefined, err);
  }
  if (/invalid|too long|must be positive|cannot exceed/i.test(msg)) {
    return new ValidationError(`Invalid input parameters: ${msg}`, undefined, err);
  }
  if (/simulation failed|trap|contract error|host function|HostError/i.test(msg)) {
    return new ContractError(msg, { rawMessage: msg }, err);
  }
  if (
    /connection|network|timeout|ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ENETDOWN|fetch (?:failed|to connect)|load failed|net::ERR_|unreachable/i.test(
      msg
    )
  ) {
    return new NetworkError(msg, undefined, err);
  }

  // Preserve raw context for unmapped panics/errors for triage
  return new ContractError(msg, { rawMessage: msg, unmapped: true }, err);
}

export function mapError(err: unknown): LinkoraError {
  if (err instanceof SimulationError) {
    return err;
  }
  const codeMapped = tryMapByErrorCode(err);
  if (codeMapped) return codeMapped;

  const networkMapped = tryMapTransportError(err);
  if (networkMapped) return networkMapped;

  const msg = err instanceof Error ? err.message : String(err);
  return mapByRegex(msg, err);
}

/**
 * Thrown when importing a portable signed transaction fails: malformed
 * payload, tampered XDR (digest mismatch), wrong network, unsigned
 * envelope, or unparseable XDR (issue #1357).
 */
export class InvalidSignedTransactionError extends LinkoraError {
  constructor(
    message: string,
    details?: Record<string, unknown>,
    originalError?: unknown
  ) {
    super(message, "INVALID_SIGNED_TRANSACTION", details, originalError);
  }
}
