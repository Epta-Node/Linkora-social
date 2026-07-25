/**
 * Shared configuration for the analytics oracle service.
 */

export interface OracleRateLimitConfig {
  windowMs: number;
  maxRequests: number;
  bypassIps: string[];
}

function parseBypassIps(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
}

export const oracleRateLimitConfig: OracleRateLimitConfig = {
  windowMs: parseInt(process.env["ORACLE_RATE_LIMIT_WINDOW_MS"] ?? "60000", 10),
  maxRequests: parseInt(process.env["ORACLE_RATE_LIMIT_MAX_REQUESTS"] ?? "10", 10),
  bypassIps: parseBypassIps(process.env["ORACLE_RATE_LIMIT_BYPASS_IPS"]),
};
