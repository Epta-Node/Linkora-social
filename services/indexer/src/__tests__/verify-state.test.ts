import { verifyDomainTotals } from "../cli/verify-state";

describe("verify-state domain totals", () => {
  it("detects a dropped domain event when raw totals still exist", async () => {
    const rawCounts: Record<string, number> = {
      profiles: 0,
      posts: 2,
      tips: 0,
      follows: 0,
    };
    const tableCounts: Record<string, number> = {
      profiles: 0,
      posts: 1,
      tips: 0,
      follows: 0,
    };

    const pg = {
      query: jest.fn(async (sql: string) => {
        const domain = Object.keys(rawCounts).find((name) => sql.includes(`FROM ${name}`));
        if (domain) {
          return { rows: [{ count: tableCounts[domain] }], rowCount: 1 };
        }

        const callIndex = pg.query.mock.calls.length - 1;
        const rawDomain = Object.keys(rawCounts)[Math.floor(callIndex / 2)];
        return { rows: [{ count: rawCounts[rawDomain] }], rowCount: 1 };
      }),
    };

    await expect(verifyDomainTotals(pg, 123)).resolves.toEqual([
      { domain: "posts", expected: 2, actual: 1 },
    ]);
  });
});
