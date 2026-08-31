import { ledgerToRelative } from "./page";

describe("ledgerToRelative", () => {
  const currentLedger = 1000000;

  it("returns 'just now' when ledger is current or invalid", () => {
    expect(ledgerToRelative(currentLedger, currentLedger)).toBe("just now");
    expect(ledgerToRelative(currentLedger + 10, currentLedger)).toBe("just now");
    expect(ledgerToRelative(0, currentLedger)).toBe("just now");
  });

  it("returns formatted seconds ago for small diffs (<60s)", () => {
    // 6 ledgers * 5s = 30s ago
    expect(ledgerToRelative(currentLedger - 6, currentLedger)).toBe("30s ago");
  });

  it("returns formatted minutes ago for diffs between 1 minute and 1 hour", () => {
    // 24 ledgers * 5s = 120s = 2m ago
    expect(ledgerToRelative(currentLedger - 24, currentLedger)).toBe("2m ago");
    // 120 ledgers * 5s = 600s = 10m ago
    expect(ledgerToRelative(currentLedger - 120, currentLedger)).toBe("10m ago");
  });

  it("returns formatted hours ago for diffs between 1 hour and 1 day", () => {
    // 720 ledgers * 5s = 3600s = 1h ago
    expect(ledgerToRelative(currentLedger - 720, currentLedger)).toBe("1h ago");
    // 3600 ledgers * 5s = 18000s = 5h ago
    expect(ledgerToRelative(currentLedger - 3600, currentLedger)).toBe("5h ago");
  });

  it("returns formatted days ago for diffs >= 1 day", () => {
    // 17280 ledgers * 5s = 86400s = 1d ago
    expect(ledgerToRelative(currentLedger - 17280, currentLedger)).toBe("1d ago");
    // 34560 ledgers * 5s = 172800s = 2d ago
    expect(ledgerToRelative(currentLedger - 34560, currentLedger)).toBe("2d ago");
  });
});
