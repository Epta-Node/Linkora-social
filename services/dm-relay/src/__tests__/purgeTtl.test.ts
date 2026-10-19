import { purgeExpiredMessages } from "../jobs/purgeTtl";
import { Pool } from "pg";

const mockPool = (rowCount: number) => ({ query: jest.fn().mockResolvedValue({ rowCount }) } as unknown as Pool);

describe("purgeExpiredMessages (#1649)", () => {
  it("returns deleted row count", async () => {
    expect(await purgeExpiredMessages(mockPool(3), 86400)).toBe(3);
  });
  it("returns 0 when nothing deleted", async () => {
    expect(await purgeExpiredMessages(mockPool(0), 3600)).toBe(0);
  });
  it("passes ttlSeconds as a string param", async () => {
    const db = mockPool(1);
    await purgeExpiredMessages(db, 604800);
    expect((db.query as jest.Mock).mock.calls[0][1][0]).toBe("604800");
  });
  it("propagates db errors", async () => {
    const db = { query: jest.fn().mockRejectedValue(new Error("fail")) } as unknown as Pool;
    await expect(purgeExpiredMessages(db, 3600)).rejects.toThrow("fail");
  });
});
