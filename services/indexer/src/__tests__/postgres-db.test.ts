import { PostgresDatabase } from "../postgres-db";

describe("PostgresDatabase analytics and governance counters", () => {
  it("computes 7d and 30d pool volume with time windows", async () => {
    const pool = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [
            { type: "deposit", address: "G1", amount: "100", ledger: 10, created_at: new Date() },
            { type: "withdraw", address: "G2", amount: "20", ledger: 11, created_at: new Date() },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { total_deposited: "150", total_withdrawn: "25", volume_7d: "90", volume_30d: "150" },
          ],
        }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const db = new PostgresDatabase(pool);

    const result = await db.getPoolAnalytics("pool-1");

    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[0][0]).toContain("ORDER BY ledger DESC");
    expect(pool.query.mock.calls[1][0]).toContain("NOW() - INTERVAL '7 days'");
    expect(pool.query.mock.calls[1][0]).toContain("NOW() - INTERVAL '30 days'");
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
