/**
 * In-process event bus tests.
 */

import { EventBus, BusEvent } from "../bus";

function evt(type: string, ledger: number): BusEvent {
  return {
    type,
    ledgerSequence: ledger,
    eventIndex: 0,
    contractId: "C1",
    topic: [type],
    data: {},
  };
}

describe("EventBus", () => {
  it("delivers events to type-specific subscribers", () => {
    const bus = new EventBus();
    const got: number[] = [];
    bus.on("PostCreated", (e) => got.push(e.ledgerSequence));

    bus.publish(evt("PostCreated", 1));
    bus.publish(evt("Follow", 2)); // different channel
    bus.publish(evt("PostCreated", 3));

    expect(got).toEqual([1, 3]);
  });

  it("delivers every event to wildcard subscribers", () => {
    const bus = new EventBus();
    const got: string[] = [];
    bus.onAny((e) => got.push(e.type));

    bus.publish(evt("PostCreated", 1));
    bus.publish(evt("Follow", 2));

    expect(got).toEqual(["PostCreated", "Follow"]);
  });

  it("unsubscribe stops further delivery", () => {
    const bus = new EventBus();
    const got: number[] = [];
    const off = bus.on("Tip", (e) => got.push(e.ledgerSequence));

    bus.publish(evt("Tip", 1));
    off();
    bus.publish(evt("Tip", 2));

    expect(got).toEqual([1]);
  });

  it("isolates listener exceptions so fanout continues", () => {
    const bus = new EventBus();
    const got: string[] = [];
    bus.onAny(() => {
      throw new Error("bad consumer");
    });
    bus.onAny((e) => got.push(e.type));

    expect(() => bus.publish(evt("PostCreated", 1))).not.toThrow();
    expect(got).toEqual(["PostCreated"]);
  });

  it("supports many subscribers without a max-listener warning", () => {
    const bus = new EventBus();
    for (let i = 0; i < 50; i++) bus.onAny(() => undefined);
    expect(bus.listenerCount("*")).toBe(50);
  });
});
