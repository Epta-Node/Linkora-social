import { readFileSync } from "fs";
import path from "path";
import {
  CONTRACT_FUNCTION_MAP,
  CONTRACT_EVENT_MAP,
} from "../generated/contract-parity.js";

/**
 * SDK ↔ contract parity (Epta-Node#1365).
 *
 * Every generated SDK method must map to a contract entrypoint (`pub fn`) in
 * lib.rs, and every generated event interface to a contract event struct.
 * Unmapped methods or stale entrypoints are flagged by these assertions.
 *
 * The generated docstrings on each method (`Contract entrypoint: \`x\``)
 * are asserted too, so the SDK surface stays cross-referenceable against
 * `packages/contracts/contracts/linkora-contracts/src/lib.rs` during review.
 */

const SDK_ROOT = path.resolve(__dirname, "../..");
const CONTRACT_SOURCE = path.resolve(
  SDK_ROOT,
  "../../packages/contracts/contracts/linkora-contracts/src/lib.rs",
);

/** Extract SDK method names declared in the generated client class body. */
function extractSdkMethods(source: string): string[] {
  const methods = new Set<string>();
  // 2-space-indented method signatures inside the class body.
  const re = /^ {2}(?:private )?(?:async )?([A-Za-z_]\w*)\(/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const name = match[1];
    // Constructor and private helpers are SDK-internal.
    if (["constructor", "simulateCall", "buildTx"].includes(name)) continue;
    methods.add(name);
  }
  return [...methods];
}

/** Extract `pub fn` entrypoints declared in the contract source. */
function extractContractEntrypoints(source: string): Set<string> {
  const entrypoints = new Set<string>();
  const re = /pub fn ([a-z0-9_]+)\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    entrypoints.add(match[1]);
  }
  return entrypoints;
}

/** Extract contract event structs declared with #[contractevent]. */
function extractContractEvents(source: string): Set<string> {
  const events = new Set<string>();
  const re =
    /#\[contractevent\]\s*#\[derive[^\n]*\]\s*pub struct ([A-Za-z_]\w*)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    events.add(match[1]);
  }
  return events;
}

/**
 * SDK event interfaces that reference contract events which no longer exist
 * in lib.rs. Surfaced explicitly here (Epta-Node#1365) so the drift stays
 * visible: these pool-proposal event structs were removed from the contract
 * (pool proposals were superseded by governance proposals — see
 * GovProposalCreatedEvent etc.), while the SDK interfaces remain exported for
 * backward compatibility. Adding a NEW stale interface here must not extend
 * this list — remove the interface or restore the contract event instead.
 */
const KNOWN_STALE_EVENT_INTERFACES = new Set([
  "ProposalSignedEvent",
  "ProposalCreatedEvent",
  "ProposalExecutedEvent",
]);

describe("SDK ↔ contract parity (Epta-Node#1365)", () => {
  let clientSource: string;
  let contractSource: string;

  beforeAll(() => {
    clientSource = readFileSync(path.join(SDK_ROOT, "src/generated/client.ts"), "utf8");
    contractSource = readFileSync(CONTRACT_SOURCE, "utf8");
  });

  it("maps every generated SDK method to a known contract entrypoint", () => {
    const sdkMethods = extractSdkMethods(clientSource);
    expect(sdkMethods.length).toBeGreaterThan(0);

    const unmapped = sdkMethods.filter((m) => !(m in CONTRACT_FUNCTION_MAP));
    expect({ unmapped }).toEqual({ unmapped: [] });
  });

  it("maps every entrypoint to an existing `pub fn` in lib.rs", () => {
    const entrypoints = extractContractEntrypoints(contractSource);
    const stale = Object.entries(CONTRACT_FUNCTION_MAP)
      .filter(([, entrypoint]) => !entrypoints.has(entrypoint))
      .map(([method, entrypoint]) => `${method} -> ${entrypoint}`);
    expect({ stale }).toEqual({ stale: [] });
  });

  it("documents every SDK method with its originating contract entrypoint", () => {
    const sdkMethods = extractSdkMethods(clientSource);
    const undocumented = sdkMethods.filter((method) => {
      const signature = new RegExp(`^ {2}(?:private )?(?:async )?${method}\\(`, "m");
      const match = signature.exec(clientSource);
      if (!match) return true;
      // The docstring block directly above the method must reference the
      // originating contract function.
      const before = clientSource.slice(Math.max(0, match.index - 400), match.index);
      return !/Contract entrypoint: `([a-z0-9_]+)`/.test(before);
    });
    expect({ undocumented }).toEqual({ undocumented: [] });
  });

  it("maps every generated event interface to a contract event struct", () => {
    const eventsSource = readFileSync(path.join(SDK_ROOT, "src/generated/events.ts"), "utf8");
    const sdkEvents = new Set<string>();
    const re = /^export interface ([A-Za-z_]\w*) \{/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(eventsSource))) {
      sdkEvents.add(match[1]);
    }
    expect(sdkEvents.size).toBeGreaterThan(0);

    const contractEvents = extractContractEvents(contractSource);

    const unmapped = [...sdkEvents].filter((e) => !(e in CONTRACT_EVENT_MAP));
    expect({ unmapped }).toEqual({ unmapped: [] });

    const stale = Object.entries(CONTRACT_EVENT_MAP)
      .filter(
        ([sdkEvent, contractEvent]) =>
          !contractEvents.has(contractEvent) && !KNOWN_STALE_EVENT_INTERFACES.has(sdkEvent),
      )
      .map(([sdkEvent, contractEvent]) => `${sdkEvent} -> ${contractEvent}`);
    expect({ stale }).toEqual({ stale: [] });

    // The surfaced stale set must stay exactly as documented — flag any
    // silently added or removed entries.
    const surfacedStale = Object.entries(CONTRACT_EVENT_MAP)
      .filter(([sdkEvent, contractEvent]) => !contractEvents.has(contractEvent))
      .map(([sdkEvent]) => sdkEvent);
    expect([...surfacedStale].sort()).toEqual([...KNOWN_STALE_EVENT_INTERFACES].sort());
  });
});
