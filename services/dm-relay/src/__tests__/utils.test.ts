import { sanitizeError } from '../utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function err(message: string): Error {
  return new Error(message);
}

// ---------------------------------------------------------------------------
// Generic internal errors
// ---------------------------------------------------------------------------

describe('sanitizeError – internal / unknown errors', () => {
  it('returns generic message for a plain unknown Error', () => {
    expect(sanitizeError(err('something broke internally'))).toBe('Internal server error');
  });

  it('returns generic message for a non-Error value (string)', () => {
    expect(sanitizeError('raw string error')).toBe('Internal server error');
  });

  it('returns generic message for a non-Error value (object)', () => {
    expect(sanitizeError({ code: 500 })).toBe('Internal server error');
  });

  it('returns generic message for null', () => {
    expect(sanitizeError(null)).toBe('Internal server error');
  });

  it('returns generic message for undefined', () => {
    expect(sanitizeError(undefined)).toBe('Internal server error');
  });
});

// ---------------------------------------------------------------------------
// SQL error redaction
// ---------------------------------------------------------------------------

describe('sanitizeError – SQL error redaction', () => {
  it('redacts a PostgreSQL duplicate-key error', () => {
    expect(
      sanitizeError(err('duplicate key value violates unique constraint "messages_pkey"'))
    ).toBe('Internal server error');
  });

  it('redacts a raw pg syntax error', () => {
    expect(sanitizeError(err('syntax error at or near "WHERE"'))).toBe('Internal server error');
  });

  it('redacts a message that names a missing relation', () => {
    expect(sanitizeError(err('relation "messages" does not exist'))).toBe('Internal server error');
  });

  it('redacts a foreign-key violation message', () => {
    expect(
      sanitizeError(err('insert or update on table "x" violates foreign key constraint'))
    ).toBe('Internal server error');
  });

  it('redacts errors that mention "postgres" or "postgresql"', () => {
    expect(sanitizeError(err('pg: connection refused'))).toBe('Internal server error');
    expect(sanitizeError(err('PostgreSQL error: column does not exist'))).toBe(
      'Internal server error'
    );
  });
});

// ---------------------------------------------------------------------------
// Connection-string redaction
// ---------------------------------------------------------------------------

describe('sanitizeError – connection string redaction', () => {
  it('redacts a PostgreSQL connection string', () => {
    expect(
      sanitizeError(err('connect ECONNREFUSED postgres://user:pass@localhost:5432/db'))
    ).toBe('Internal server error');
  });

  it('redacts a Redis connection string', () => {
    expect(sanitizeError(err('connect ECONNREFUSED redis://localhost:6379'))).toBe(
      'Internal server error'
    );
  });

  it('redacts a MongoDB connection string', () => {
    expect(sanitizeError(err('failed to connect mongodb+srv://user:pwd@cluster.example.net/db'))).toBe(
      'Internal server error'
    );
  });
});

// ---------------------------------------------------------------------------
// File-path redaction
// ---------------------------------------------------------------------------

describe('sanitizeError – file path redaction', () => {
  it('redacts a Unix file path with a .ts extension', () => {
    expect(sanitizeError(err('Cannot find module /home/user/project/src/server.ts'))).toBe(
      'Internal server error'
    );
  });

  it('redacts a Unix file path with a .env extension', () => {
    expect(sanitizeError(err('ENOENT: no such file or directory /app/.env'))).toBe(
      'Internal server error'
    );
  });

  it('redacts a stack-trace fragment', () => {
    expect(
      sanitizeError(err('TypeError: Cannot read properties of undefined\n    at Object.<anonymous> (/app/src/utils.ts:42:5)'))
    ).toBe('Internal server error');
  });
});

// ---------------------------------------------------------------------------
// Known-safe (allow-listed) errors
// ---------------------------------------------------------------------------

describe('sanitizeError – known-safe errors pass through', () => {
  it('passes through an Invalid sender message', () => {
    expect(sanitizeError(err('Invalid sender address format'))).toBe(
      'Invalid sender address format'
    );
  });

  it('passes through an Invalid recipient message', () => {
    expect(sanitizeError(err('Invalid recipient address format'))).toBe(
      'Invalid recipient address format'
    );
  });

  it('passes through an Invalid signature message', () => {
    expect(sanitizeError(err('Invalid signature'))).toBe('Invalid signature');
  });

  it('passes through a Timestamp message', () => {
    const msg = 'Timestamp too old or too far in future. Skew: 60s, max: 30s';
    expect(sanitizeError(err(msg))).toBe(msg);
  });

  it('passes through an Authentication message', () => {
    expect(sanitizeError(err('Authentication required'))).toBe('Authentication required');
  });

  it('passes through a Validation message', () => {
    expect(sanitizeError(err('Validation failed: missing field'))).toBe(
      'Validation failed: missing field'
    );
  });

  it('passes through an Invalid cursor message', () => {
    expect(sanitizeError(err('Invalid cursor: bad base64'))).toBe('Invalid cursor: bad base64');
  });

  it('passes through an already exists message', () => {
    expect(sanitizeError(err('already exists in database'))).toBe('already exists in database');
  });

  it('passes through a Message index message', () => {
    expect(sanitizeError(err('Message index already used for this sender-recipient pair'))).toBe(
      'Message index already used for this sender-recipient pair'
    );
  });
});

// ---------------------------------------------------------------------------
// Fail-closed: safe-looking messages that still contain internal details
// ---------------------------------------------------------------------------

describe('sanitizeError – safe prefix with embedded internal detail is redacted', () => {
  it('redacts a message that starts with a safe prefix but contains a connection string', () => {
    // Even if the message starts with "Validation", it must not leak a conn string.
    expect(
      sanitizeError(err('Validation failed: postgres://user:pass@host/db is unreachable'))
    ).toBe('Internal server error');
  });

  it('redacts a message that starts with a safe prefix but contains a file path', () => {
    expect(
      sanitizeError(err('Invalid sender: checked /etc/config.json'))
    ).toBe('Internal server error');
  });
});
