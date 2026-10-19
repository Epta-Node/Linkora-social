import { xdr } from "@stellar/stellar-base";
import { SimulationError } from "./errors.js";

export function mapMultiOperationAuth(
  results: unknown[],
  ops: Array<{ method: string }>
): xdr.SorobanAuthorizationEntry[][] {
  if (results.length !== ops.length) {
    throw new SimulationError(
      `Multi-operation simulation result mismatch: expected ${ops.length} auth entries for ${ops.length} operations, got ${results.length}.`,
      undefined,
      results
    );
  }
  return results.map((entry, index) => {
    const auth = (entry as { auth?: unknown } | null)?.auth;
    if (!Array.isArray(auth)) {
      throw new SimulationError(
        `Multi-operation simulation result for operation ${index} (${ops[index].method}) is missing its auth array.`,
        undefined,
        entry
      );
    }
    return auth as xdr.SorobanAuthorizationEntry[];
  });
}
