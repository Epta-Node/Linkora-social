/**
 * Input validation and sanitisation utilities for Linkora web forms.
 * All validation is pure (no side-effects) so it can be used in both
 * client components and server actions.
 */

// ── Constants ────────────────────────────────────────────────────────────────

export const POST_MAX_CHARS = 280;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
/** Stellar / Soroban public key: G… or C… followed by 55 base-32 chars */
const STELLAR_ADDRESS_RE = /^[GC][A-Z2-7]{55}$/;
/** Allowed username characters: alphanumeric + underscore */
const USERNAME_RE = /^[a-zA-Z0-9_]+$/;

// ── Sanitisation ─────────────────────────────────────────────────────────────

/**
 * Strip tags that can carry executable content while preserving plain text.
 * This is a lightweight defence-in-depth measure; the contract itself never
 * renders HTML, but we sanitise before display and before submission.
 */
export function sanitisePostContent(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')   // strip all remaining HTML tags
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '') // strip inline event handlers
    .trim();
}

// ── Validators ───────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validatePostContent(value: string): ValidationResult {
  const sanitised = sanitisePostContent(value);
  if (!sanitised) return { valid: false, error: 'Post content cannot be empty.' };
  if (sanitised.length > POST_MAX_CHARS)
    return {
      valid: false,
      error: `Post must be ${POST_MAX_CHARS} characters or fewer (currently ${sanitised.length}).`,
    };
  return { valid: true };
}

export function validateUsername(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, error: 'Username is required.' };
  if (trimmed.length < USERNAME_MIN)
    return { valid: false, error: `Username must be at least ${USERNAME_MIN} characters.` };
  if (trimmed.length > USERNAME_MAX)
    return { valid: false, error: `Username must be ${USERNAME_MAX} characters or fewer.` };
  if (!USERNAME_RE.test(trimmed))
    return { valid: false, error: 'Username may only contain letters, numbers, and underscores.' };
  return { valid: true };
}

export function validateStellarAddress(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, error: 'Stellar address is required.' };
  if (!STELLAR_ADDRESS_RE.test(trimmed))
    return { valid: false, error: 'Enter a valid Stellar address (starts with G or C, 56 characters).' };
  return { valid: true };
}

export function validateAmount(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, error: 'Amount is required.' };
  const num = Number(trimmed);
  if (isNaN(num) || trimmed === '')
    return { valid: false, error: 'Amount must be a number.' };
  if (num <= 0)
    return { valid: false, error: 'Amount must be greater than zero.' };
  return { valid: true };
}

export function validateSearchQuery(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, error: 'Please enter a search term.' };
  if (trimmed.length > 200)
    return { valid: false, error: 'Search query must be 200 characters or fewer.' };
  return { valid: true };
}
