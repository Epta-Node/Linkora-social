import { getPoolRecord, recordPoolDeposit, resetPoolState } from "../poolStore";

describe("poolStore deposits", () => {
  afterEach(() => {
    resetPoolState();
  });

  it("credits sequential deposits instead of overwriting the balance", () => {
    resetPoolState("test-pool");
    recordPoolDeposit("test-pool", "10");
    recordPoolDeposit("test-pool", "5");

    expect(getPoolRecord("test-pool").balance).toBe("15 XLM");
  });

  it("credits deposits on top of a pre-existing formatted balance", () => {
    recordPoolDeposit("creator-fund", "10");

    expect(getPoolRecord("creator-fund").balance).toBe("18,250 XLM");
  });

  it("ignores a non-numeric deposit amount without touching the balance", () => {
    resetPoolState("test-pool-2");
    recordPoolDeposit("test-pool-2", "not-a-number");

    expect(getPoolRecord("test-pool-2").balance).toBe("0 XLM");
  });
});
