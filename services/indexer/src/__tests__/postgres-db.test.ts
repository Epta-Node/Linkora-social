import { PostgresDatabase } from "../postgres-db";

describe("PostgresDatabase analytics and governance counters", () => {
  it("computes 7d and 30d pool volume with time windows", async () => {
    const pool = {
      query: jest.fn().mockResolvedValueOnce({
        rows: [
          {
            type: "deposit",
            address: "G1",
            amount: "100",
            ledger: 10,
            created_at: new Date(),
            total_deposited: "100",
            total_withdrawn: "20",
            volume_7d: "90",
            volume_30d: "150",
          },
          { type: "withdraw", address: "G2", amount: "20", ledger: 11, created_at: new Date() },
        ],
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const db = new PostgresDatabase(pool);

    const result = await db.getPoolAnalytics("pool-1");

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toContain("ORDER BY ledger DESC");
    expect(pool.query.mock.calls[0][0]).toContain("NOW() - INTERVAL '7 days'");
    expect(pool.query.mock.calls[0][0]).toContain("NOW() - INTERVAL '30 days'");
    expect(result.volume_7d).toBe("90");
    expect(result.volume_30d).toBe("150");
  });

  it("updates proposal vote tallies in a single transactional statement", async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [{ proposal_id: "9" }] }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const db = new PostgresDatabase(pool);

    const inserted = await db.insertGovernanceVote({
      proposal_id: 9n,
      voter: "GVOTER",
      support: true,
      ledger: 420,
    });

    expect(inserted).toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toContain("WITH inserted AS");
    expect(pool.query.mock.calls[0][0]).toContain("votes_for = gp.votes_for +");
    expect(pool.query.mock.calls[0][1]).toEqual(["9", "GVOTER", true, 420, 420, "9"]);
  });
});

describe("PostgresDatabase search", () => {
  it("escapes LIKE wildcards and maps follower counts for profile search", async () => {
    const pool = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ total: 1 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              address: "GPROFILE",
              username: "100%",
              creator_token: "GTOKEN",
              updated_ledger: 42,
              follower_count: 7,
            },
          ],
        }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const db = new PostgresDatabase(pool);
    const result = await db.searchProfiles({ q: "100%", limit: 10, offset: 0 });

    expect(pool.query.mock.calls[0][1]).toEqual(["%100\\%%"]);
    expect(pool.query.mock.calls[1][1]).toEqual(["%100\\%%", "100%", "100\\%%", 0, 10]);
    expect(result.total).toBe(1);
    expect(result.profiles[0]).toEqual({
      address: "GPROFILE",
      username: "100%",
      creator_token: "GTOKEN",
      updated_ledger: 42,
      follower_count: 7,
    });
  });

  it("searches pools by escaped pattern and serialises bigint balances", async () => {
    const pool = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ total: 1 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              pool_id: "comm%unity",
              token: "GTOKEN",
              balance: "5000000000",
              admins: ["GADMIN"],
              threshold: 1,
              created_ledger: 10,
              updated_ledger: 11,
            },
          ],
        }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const db = new PostgresDatabase(pool);
    const result = await db.searchPools({ q: "comm%", limit: 5, offset: 0 });

    expect(pool.query.mock.calls[0][1]).toEqual(["%comm\\%%"]);
    expect(pool.query.mock.calls[1][1]).toEqual(["%comm\\%%", "comm%", 0, 5]);
    expect(result.total).toBe(1);
    expect(result.pools[0].balance).toBe(BigInt("5000000000"));
  });
});
