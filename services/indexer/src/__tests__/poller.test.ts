/**
 * Adaptive poll-interval tests.
 */

import { AdaptivePoll } from "../poller";

describe("AdaptivePoll", () => {
  it("doubles the interval on an empty batch, capped at maxMs", () => {
    const poll = new AdaptivePoll({ minMs: 100, maxMs: 5000, pageSize: 100, startMs: 1000 });
    expect(poll.next(0)).toBe(2000);
    expect(poll.next(0)).toBe(4000);
    expect(poll.next(0)).toBe(5000); // capped
    expect(poll.next(0)).toBe(5000);
  });

  it("halves the interval on a full page, floored at minMs", () => {
    const poll = new AdaptivePoll({ minMs: 100, maxMs: 5000, pageSize: 100, startMs: 800 });
    expect(poll.next(100)).toBe(400);
    expect(poll.next(100)).toBe(200);
    expect(poll.next(100)).toBe(100); // floored
    expect(poll.next(100)).toBe(100);
  });

  it("holds steady on a partial batch", () => {
    const poll = new AdaptivePoll({ minMs: 100, maxMs: 5000, pageSize: 100, startMs: 1000 });
    expect(poll.next(50)).toBe(1000);
    expect(poll.next(1)).toBe(1000);
    expect(poll.next(99)).toBe(1000);
  });

  it("defaults to starting at maxMs (slow start)", () => {
    const poll = new AdaptivePoll({ pageSize: 100 });
    expect(poll.intervalMs).toBe(5000);
    expect(poll.minMs).toBe(100);
    expect(poll.maxMs).toBe(5000);
  });

  it("reacts to changing load: speeds up then backs off", () => {
    const poll = new AdaptivePoll({ minMs: 100, maxMs: 5000, pageSize: 100, startMs: 5000 });
    // Burst of full pages drives it down toward the floor.
    poll.next(100);
    poll.next(100);
    poll.next(100);
    poll.next(100);
    poll.next(100);
    poll.next(100);
    expect(poll.intervalMs).toBe(100);
    // Then it goes idle and backs off again.
    expect(poll.next(0)).toBe(200);
  });
});
