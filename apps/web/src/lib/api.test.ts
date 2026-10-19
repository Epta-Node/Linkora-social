import { fetchPools, fetchIsPaused, createTtlCache } from './api';
import { LinkoraClient } from '../../../../packages/sdk/src/client';

jest.mock('../../../../packages/sdk/src/client', () => ({
  LinkoraClient: jest.fn(),
}));

const mockFetch = jest.fn();

beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockReset();
});

function jsonResponse(body: unknown, init: Partial<{ ok: boolean; status: number; statusText: string }> = {}) {
  const { ok = true, status = 200, statusText = 'OK' } = init;
  return { ok, status, statusText, json: async () => body };
}

describe('fetchPools', () => {
  it('throws a descriptive error when the indexer returns a non-ok response', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({}, { ok: false, status: 500, statusText: 'Internal Server Error' })
    );

    await expect(fetchPools()).rejects.toThrow('Indexer returned 500: Internal Server Error');
  });

  it('propagates network failures instead of masking them as an empty pool list', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    await expect(fetchPools()).rejects.toThrow('Network error');
  });

  it('maps the indexer pool payload into PoolData', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        pools: [
          { pool_id: '7', token: 'XLM', balance: '1000', admins: ['GALICE', 'GBOB'], threshold: 2 },
        ],
      })
    );

    await expect(fetchPools()).resolves.toEqual([
      { id: '7', token: 'XLM', balance: 1000n, adminCount: 2, threshold: 2 },
    ]);
  });

  it('accepts a bare array response and falls back to zero balance/admin defaults', async () => {
    mockFetch.mockResolvedValue(jsonResponse([{ id: '9', token: 'USDC' }]));

    await expect(fetchPools()).resolves.toEqual([
      { id: '9', token: 'USDC', balance: 0n, adminCount: 0, threshold: 1 },
    ]);
  });

  it('returns an empty list when the indexer has no pools', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ pools: [] }));

    await expect(fetchPools()).resolves.toEqual([]);
  });
});

describe('createTtlCache', () => {
  it('invokes the loader once for reads inside the TTL window', async () => {
    const load = jest.fn().mockResolvedValue('value');
    const cache = createTtlCache({ load, ttlMs: 10_000 });

    await expect(cache.get()).resolves.toBe('value');
    await expect(cache.get()).resolves.toBe('value');

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent reads into a single loader call', async () => {
    const load = jest.fn().mockResolvedValue('value');
    const cache = createTtlCache({ load, ttlMs: 10_000 });

    await expect(Promise.all([cache.get(), cache.get()])).resolves.toEqual(['value', 'value']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('refetches once the TTL has expired', async () => {
    const load = jest.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    const cache = createTtlCache({ load, ttlMs: 0 });

    await expect(cache.get()).resolves.toBe('first');
    await expect(cache.get()).resolves.toBe('second');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('refetches immediately after invalidate()', async () => {
    const load = jest.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    const cache = createTtlCache({ load, ttlMs: 10_000 });

    await cache.get();
    cache.invalidate();
    await expect(cache.get()).resolves.toBe('second');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not cache a rejected load and lets the next read retry', async () => {
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('recovered');
    const cache = createTtlCache({ load, ttlMs: 10_000 });

    await expect(cache.get()).rejects.toThrow('boom');
    await expect(cache.get()).resolves.toBe('recovered');
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('fetchIsPaused', () => {
  it('reports the contract pause state', async () => {
    (LinkoraClient as unknown as jest.Mock).mockImplementationOnce(() => ({
      isPaused: jest.fn().mockResolvedValue(true),
    }));

    await expect(fetchIsPaused()).resolves.toBe(true);
  });

  it('fails open when the RPC cannot be reached', async () => {
    (LinkoraClient as unknown as jest.Mock).mockImplementationOnce(() => ({
      isPaused: jest.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    }));

    await expect(fetchIsPaused()).resolves.toBe(false);
  });
});