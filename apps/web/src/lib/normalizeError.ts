export function normalizeError(err: any): string {
  if (!err) return 'An unexpected error occurred.';
  const msg = typeof err === 'string' ? err : err?.message || err?.toString?.() || '';
  if (/user rejected/i.test(msg) || /denied by user/i.test(msg)) return 'User rejected the transaction.';
  if (/insufficient balance/i.test(msg) || /balance too low/i.test(msg)) return 'Insufficient balance.';
  if (/timeout/i.test(msg) || /timed out/i.test(msg)) return 'Network timeout. Please try again.';
  if (/network error/i.test(msg) || /failed to fetch/i.test(msg)) return 'Network error. Check your connection.';
  if (msg.length > 200) return 'An unexpected error occurred.';
  return msg || 'An unexpected error occurred.';
}
