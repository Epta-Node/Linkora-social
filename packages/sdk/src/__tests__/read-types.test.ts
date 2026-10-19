import type { Report } from "../generated/types";
import type { LinkoraClient } from "../client";
import type { ContractState } from "../state";

function assertReadMethodTypes(client: LinkoraClient): void {
  const report: Promise<Report | null> = client.getReport(1n);
  const pool: Promise<import("../generated/types").Pool | null> = client.getPool("community");
  const state: Promise<ContractState> = client.getContractState();
  void [report, pool, state];
  // @ts-expect-error getReport exposes its generated DTO, never an untyped value.
  const incorrect: Promise<string> = client.getReport(1n);
  void incorrect;
}

describe("generated SDK read method result types (#1349)", () => {
  it("keeps read DTO contracts compile-time checked", () => {
    expect(assertReadMethodTypes).toBeDefined();
  });
});
