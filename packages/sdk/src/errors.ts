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

// ── Contract error codes ──────────────────────────────────────────────────────

export enum ContractErrorCode {
  AlreadyInitialized = 1,
  UsernameTaken = 2,
  UsernameTooLong = 3,
  NotAdmin = 4,
  OnlyAuthor = 5,
  Blocked = 6,
  InsufficientAllowance = 7,
  InsufficientBalance = 8,
  CooldownActive = 9,
  NotFound = 10,
  PostTooLong = 11,
  InvalidInput = 12,
  SimulationFailed = 13,
}

type ErrorConstructor = new (
  message: string,
  details?: Record<string, unknown>,
  originalError?: unknown
) => LinkoraError;

const errorCodeRegistry: Map<ContractErrorCode, ErrorConstructor> = new Map([
  [ContractErrorCode.AlreadyInitialized, ContractError],
  [ContractErrorCode.UsernameTaken, ValidationError],
  [ContractErrorCode.UsernameTooLong, ValidationError],
  [ContractErrorCode.NotAdmin, UnauthorizedError],
  [ContractErrorCode.OnlyAuthor, UnauthorizedError],
  [ContractErrorCode.Blocked, UnauthorizedError],
  [ContractErrorCode.InsufficientAllowance, InsufficientBalanceError],
  [ContractErrorCode.InsufficientBalance, InsufficientBalanceError],
  [ContractErrorCode.CooldownActive, CooldownError],
  [ContractErrorCode.NotFound, NotFoundError],
  [ContractErrorCode.PostTooLong, ValidationError],
  [ContractErrorCode.InvalidInput, ValidationError],
  [ContractErrorCode.SimulationFailed, ContractError],
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
  if (/simulation failed|trap|contract error|host function/i.test(msg)) {
    return new ContractError(msg, undefined, err);
  }
  if (/connection|network|timeout|ECONNREFUSED|fetch failed/i.test(msg)) {
    return new NetworkError(msg, undefined, err);
  }

  return new LinkoraError(msg, "LINKORA_ERROR", undefined, err);
}

export function mapError(err: unknown): LinkoraError {
  if (err instanceof SimulationError) {
    return err;
  }
  const codeMapped = tryMapByErrorCode(err);
  if (codeMapped) return codeMapped;

  const msg = err instanceof Error ? err.message : String(err);
  return mapByRegex(msg, err);
}
