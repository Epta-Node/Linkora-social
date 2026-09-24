import { mapMultiOperationAuth } from "../multi-operation-auth";
import { SimulationError } from "../errors";

describe("multi-operation simulation auth mapping (#1348)", () => {
  it("keeps each simulated auth set bound to its reordered operation", () => {
    const likeAuth = [{ operation: "like_post" }];
    const followAuth = [{ operation: "follow" }];
    const mapped = mapMultiOperationAuth(
      [{ auth: likeAuth }, { auth: followAuth }],
      [{ method: "like_post" }, { method: "follow" }]
    );

    expect(mapped).toEqual([likeAuth, followAuth]);
  });

  it("includes the operation name when the RPC omits its auth result", () => {
    expect(() => mapMultiOperationAuth([{}], [{ method: "follow" }])).toThrow(
      "operation 0 (follow) is missing its auth array"
    );
  });

  it("rejects an operation/result count mismatch descriptively", () => {
    try {
      mapMultiOperationAuth([{ auth: [] }], [{ method: "follow" }, { method: "like_post" }]);
      throw new Error("expected mapping to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(SimulationError);
      expect((error as Error).message).toContain("expected 2 auth entries for 2 operations, got 1");
    }
  });
});
