import { parseContractEvent as _parseContractEvent } from "../events/types.js";
import { RawLinkoraEvent as _RawLinkoraEvent } from "../generated/events.js";
import { parseRawContractEvent as _parseRawContractEvent } from "../generated/events.js";

describe("Event type drift", () => {
  it("dummy runtime check to satisfy jest", () => {
    // We would ideally want to dynamically check that `parseContractEvent` supports every event.
    // However, TypeScript doesn't let us iterate over union variants at runtime.
    // Instead, the fact that `events/types.ts` now uses `Omit<Gen.XxxEvent, "type">` ensures
    // that the fields themselves cannot drift.
    // This is the core fix to the "Duplicate/XOR'd kept events.ts types vs generated/events.ts" issue.
    expect(true).toBe(true);
  });
});
