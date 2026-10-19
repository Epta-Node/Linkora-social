import { parseContractEvent as _parseContractEvent } from "../events/types.js";
import { RawLinkoraEvent as _RawLinkoraEvent } from "../generated/events.js";
import { parseRawContractEvent as _parseRawContractEvent } from "../generated/events.js";

describe("Event type drift", () => {
  it("dummy runtime check to satisfy jest", () => {
    expect(typeof parseContractEvent).toBe("function");
    expect(typeof parseRawContractEvent).toBe("function");
  });
});
