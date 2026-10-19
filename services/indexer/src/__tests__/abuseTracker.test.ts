/**
 * Tests for abuseTracker LRU eviction and size cap.
 */

import { abuseTracker, recordAbuseAttempt, clearAbuseTracker, MAX_ABUSE_ENTRIES } from "../logger";

describe("abuseTracker size cap and eviction", () => {
  beforeEach(() => {
    clearAbuseTracker();
  });

  it("bounds map size to MAX_ABUSE_ENTRIES by evicting oldest entries", () => {
    for (let i = 0; i < MAX_ABUSE_ENTRIES + 10; i++) {
      recordAbuseAttempt(`192.168.1.${i}`);
    }

    expect(abuseTracker.size).toBeLessThanOrEqual(MAX_ABUSE_ENTRIES);
    expect(abuseTracker.has("192.168.1.0")).toBe(false);
    expect(abuseTracker.has(`192.168.1.${MAX_ABUSE_ENTRIES + 9}`)).toBe(true);
  });
});
