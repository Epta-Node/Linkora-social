import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { xdr } from "@stellar/stellar-sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const WASM = resolve(ROOT, "packages/contracts/contracts/linkora-contracts/linkora_contracts.wasm");
const OUT_DIR = resolve(ROOT, "packages/sdk/src/generated");

// ── Soroban-to-TypeScript type mappings ───────────────────────────────────

const SOROBAN_TO_TS: Record<string, string> = {
  bool: "boolean",
  u32: "number",
  i32: "number",
  u64: "bigint",
  i64: "bigint",
  i128: "bigint",
  u128: "bigint",
  address: "string",
  string: "string",
  symbol: "string",
  bytes: "Uint8Array",
};

const SOROBAN_TO_SCVAL: Record<string, string> = {
  address: 'nativeToScVal(v, { type: "address" })',
  string: "nativeToScVal(v)",
  symbol: 'nativeToScVal(v, { type: "symbol" })',
  u32: 'nativeToScVal(v, { type: "u32" })',
  i32: 'nativeToScVal(v, { type: "i32" })',
  u64: 'nativeToScVal(v, { type: "u64" })',
  i64: 'nativeToScVal(v, { type: "i64" })',
  i128: 'nativeToScVal(v, { type: "i128" })',
  u128: 'nativeToScVal(v, { type: "u128" })',
  bool: "nativeToScVal(v)",
};

// ── Parsed representations ────────────────────────────────────────────────

interface StructType {
  name: string;
  fields: { name: string; type: string }[];
}

interface EnumType {
  name: string;
  variants: { name: string }[];
}

interface EventType {
  name: string;
  topicFields: { name: string; type: string }[];
  dataFields: { name: string; type: string }[];
}

interface FuncParam {
  name: string;
  type: string;
  sorobanType?: string;
}

interface FunctionType {
  name: string;
  inputs: FuncParam[];
  outputs: FuncParam[];
}

// ── Type resolution ───────────────────────────────────────────────────────

function resolveType(t: xdr.ScSpecTypeDef): string {
  const sw = t.switch().name;
  // Strip "scSpecType" prefix for v15+ SDK
  const simple = sw.replace(/^scSpecType/, "").toLowerCase();

  if (SOROBAN_TO_TS[simple]) return SOROBAN_TO_TS[simple];

  switch (sw) {
    case "scSpecTypeOption": {
      const inner = resolveType(t.option().valueType());
      // Don't doubly wrap Option<Option<T>>
      if (inner.endsWith(" | null")) return inner;
      return `${inner} | null`;
    }
    case "scSpecTypeVec":
      return `${resolveType(t.vec().elementType())}[]`;
    case "scSpecTypeMap":
      return `Record<${resolveType(t.map().keyType())}, ${resolveType(t.map().valueType())}>`;
    case "scSpecTypeBytesN":
      return "Uint8Array";
    case "scSpecTypeUdt":
      return t.udt().name().toString();
    case "scSpecTypeResult":
      return `${resolveType(t.result().okType())} | ${resolveType(t.result().errorType())}`;
    case "scSpecTypeTuple":
      return `[${t
        .tuple()
        .valueTypes()
        .map((vt: xdr.ScSpecTypeDef) => resolveType(vt))
        .join(", ")}]`;
    case "scSpecTypeVoid":
      return "void";
    default:
      return simple || sw;
  }
}

function scvalForType(tsType: string, v: string): string {
  const direct = SOROBAN_TO_SCVAL[tsType];
  if (direct) return direct.replace(/v/g, v);
  if (tsType === "boolean") return `nativeToScVal(${v})`;
  if (tsType === "Uint8Array") return `nativeToScVal(${v}, { type: "bytes" })`;
  if (tsType.endsWith(" | null")) {
    const inner = tsType.replace(/ \| null$/, "");
    return `${v} === null ? nativeToScVal(null) : ${scvalForType(inner, v)}`;
  }
  // For custom struct types, wrap with Address if it's known
  if (tsType === "string" || tsType === "number" || tsType === "bigint")
    return `nativeToScVal(${v})`;
  return `nativeToScVal(${v})`;
}

// ── Spec parsing ──────────────────────────────────────────────────────────

function parseSpec(): {
  structs: StructType[];
  enums: EnumType[];
  events: EventType[];
  functions: FunctionType[];
} {
  if (!existsSync(WASM)) {
    throw new Error(`WASM not found at ${WASM} — run 'pnpm build:contracts' first.`);
  }

  const raw = execSync(
    `stellar contract inspect --wasm ${WASM} --output xdr-base64-array 2>/dev/null`,
    { encoding: "utf-8" }
  ).trim();

  const xdrStrings: string[] = JSON.parse(raw);

  const structs: StructType[] = [];
  const enums: EnumType[] = [];
  const events: EventType[] = [];
  const functions: FunctionType[] = [];

  for (const xdrStr of xdrStrings) {
    const entry = xdr.ScSpecEntry.fromXDR(xdrStr, "base64");
    const kind = entry.switch().name;

    if (kind === "scSpecEntryFunctionV0") {
      const f = entry.functionV0();
      const name = f.name().toString();
      const inputs = f.inputs().map((i: xdr.ScSpecFunctionInputV0) => {
        const rawType = i.type();
        return {
          name: i.name().toString(),
          type: resolveType(rawType),
          sorobanType: rawType
            .switch()
            .name.replace(/^scSpecType/, "")
            .toLowerCase(),
        };
      });
      const outputs = f.outputs().map((o: xdr.ScSpecTypeDef) => ({
        name: "",
        type: resolveType(o),
      }));
      functions.push({ name, inputs, outputs });
    } else if (kind === "scSpecEntryUdtStructV0") {
      const s = entry.udtStructV0();
      const name = s.name().toString();
      const fields = s.fields().map((f: xdr.ScSpecUdtStructFieldV0) => ({
        name: f.name().toString(),
        type: resolveType(f.type()),
      }));
      structs.push({ name, fields });
    } else if (kind === "scSpecEntryUdtUnionV0") {
      const u = entry.udtUnionV0();
      const name = u.name().toString();
      const cases = u.cases() as unknown as Array<{
        _value: { name(): { toString(): string } };
      }>;
      const variants = cases.map((c) => ({
        name: c._value.name().toString(),
      }));
      enums.push({ name, variants });
    } else if (kind === "scSpecEntryUdtEnumV0") {
      const e = entry.udtEnumV0();
      const name = e.name().toString();
      const cases = e.cases() as unknown as Array<{
        name(): { toString(): string };
      }>;
      const variants = cases.map((c) => ({
        name: c.name().toString(),
      }));
      enums.push({ name, variants });
    } else if (kind === "scSpecEntryEventV0") {
      const ev = entry.eventV0();
      const name = ev.name().toString();
      const allParams = ev.params();
      // All params are event fields; the topic/data distinction
      // is not recoverable from the spec alone, so we treat all
      // as topic fields for interface generation.
      const topicFields = allParams.map((p: xdr.ScSpecUdtStructFieldV0) => ({
        name: p.name().toString(),
        type: resolveType(p.type()),
      }));
      events.push({ name, topicFields, dataFields: [] });
    }
  }

  return { structs, enums, events, functions };
}

// ── Code generation ───────────────────────────────────────────────────────

function generateTypes(structs: StructType[], enums: EnumType[]): string {
  const lines: string[] = [
    "// Auto-generated by packages/codegen/generate.ts — do not edit manually.",
    "/* eslint-disable */",
    "",
  ];

  lines.push("// ── Enums ───────────────────────────────────────────────────");
  lines.push("");
  for (const en of enums) {
    lines.push(`export enum ${en.name} {`);
    for (const v of en.variants) {
      lines.push(`  ${v.name} = "${v.name}",`);
    }
    lines.push("}");
    lines.push("");
  }

  lines.push("// ── Structs / Contract Types ───────────────────────────────");
  lines.push("");
  for (const st of structs) {
    lines.push(`export interface ${st.name} {`);
    for (const f of st.fields) {
      lines.push(`  ${f.name}: ${f.type};`);
    }
    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

function generateClient(
  functions: FunctionType[],
  structs: StructType[],
  enums: EnumType[]
): string {
  const knownTypes = new Set([...structs.map((s) => s.name), ...enums.map((e) => e.name)]);
  const knownTypeNames = [...structs.map((s) => s.name), ...enums.map((e) => e.name)];

  const lines: string[] = [
    "// Auto-generated by packages/codegen/generate.ts — do not edit manually.",
    "/* eslint-disable */",
    "",
    "import {",
    "  rpc,",
    "  Contract,",
    "  nativeToScVal,",
    "  scValToNative,",
    "  xdr,",
    "  Address,",
    "  TransactionBuilder,",
    "  Account,",
    "  Keypair,",
    '} from "@stellar/stellar-sdk";',
    'import { NotFoundError, mapError } from "../errors";',
    ...(knownTypeNames.length > 0
      ? [`import type { ${knownTypeNames.join(", ")} } from "./types";`, ""]
      : [""]),
    "const { isSimulationError, isSimulationSuccess } = rpc.Api;",
    "",
    'const DEFAULT_NETWORK = "Test SDF Network ; September 2015";',
    "const DEFAULT_TIMEOUT = 30;",
    "",
  ];

  lines.push(generateHelperFuncs());
  lines.push(
    "/**",
    " * scvAddressVec only handles string[] where every element is a Stellar address.",
    " * For Vec<T> where T is not an address (e.g. Vec<u64>), the generic",
    " * nativeToScVal fallback in argToScVal is used, which may produce",
    " * incorrect ScVal encoding for future contract functions.",
    " * If a new function uses Vec<non-address>, add a dedicated helper.",
    " */",
    ""
  );

  // Client class
  lines.push("export class GeneratedLinkoraClient {");
  lines.push("  private contractId: string;");
  lines.push("  private rpcUrl: string;");
  lines.push("  private networkPassphrase: string;");
  lines.push("");
  lines.push(
    "  constructor(config: { contractId: string; rpcUrl: string; networkPassphrase?: string }) {"
  );
  lines.push("    this.contractId = config.contractId;");
  lines.push("    this.rpcUrl = config.rpcUrl;");
  lines.push("    this.networkPassphrase = config.networkPassphrase || DEFAULT_NETWORK;");
  lines.push("  }");
  lines.push("");

  // simulateCall helper
  lines.push(
    "  private async simulateCall(method: string, ...args: xdr.ScVal[]): Promise<xdr.ScVal | null> {"
  );
  lines.push("    const server = new rpc.Server(this.rpcUrl);");
  lines.push("    const contract = new Contract(this.contractId);");
  lines.push("    const op = contract.call(method, ...args);");
  lines.push("    const source = Keypair.random();");
  lines.push('    const account = new Account(source.publicKey(), "0");');
  lines.push("    const tx = new TransactionBuilder(account, {");
  lines.push('      fee: "100",');
  lines.push("      networkPassphrase: this.networkPassphrase,");
  lines.push("    })");
  lines.push("      .addOperation(op)");
  lines.push("      .setTimeout(DEFAULT_TIMEOUT)");
  lines.push("      .build();");
  lines.push("    const result = await server.simulateTransaction(tx);");
  lines.push("    if (isSimulationError(result)) {");
  lines.push("      throw mapError(result.error);");
  lines.push("    }");
  lines.push("    if (!isSimulationSuccess(result) || !result.result) return null;");
  lines.push("    return result.result.retval;");
  lines.push("  }");
  lines.push("");

  // buildTx helper
  lines.push("  private buildTx(method: string, ...args: xdr.ScVal[]): string {");
  lines.push("    const contract = new Contract(this.contractId);");
  lines.push("    const op = contract.call(method, ...args);");
  lines.push("    const source = Keypair.random();");
  lines.push('    const account = new Account(source.publicKey(), "0");');
  lines.push("    const tx = new TransactionBuilder(account, {");
  lines.push('      fee: "100",');
  lines.push("      networkPassphrase: this.networkPassphrase,");
  lines.push("    })");
  lines.push("      .addOperation(op)");
  lines.push("      .setTimeout(DEFAULT_TIMEOUT)");
  lines.push("      .build();");
  lines.push('    return tx.toEnvelope().toXDR("base64");');
  lines.push("  }");
  lines.push("");

  // Functions whose name starts with a known read-only prefix are classified
  // as read methods (simulate-only). All others — including functions that
  // return a value but mutate state (e.g. create_post) — go in writeMethods.
  // Additionally, some contract functions return values but are intended to be write-only.
  // We explicitly force these to be treated as write methods.
  const FORCE_WRITE = new Set([
    "pay_rent",
    "report_post",
    "review_report",
    "register_oracle",
    "verify_analytics_attestation",
    "set_rent_rate_bps",
    "batch_bump_user_graph",
  ]);

  const READ_PREFIXES = ["get_", "is_", "has_", "effective_", "gov_get_"];
  const isReadName = (name: string) => READ_PREFIXES.some((p) => name.startsWith(p));

  const readMethods = functions.filter(
    (f) => f.outputs.length > 0 && f.outputs[0].type !== "void" && isReadName(f.name) && !FORCE_WRITE.has(f.name)
  );
  const writeMethods = functions.filter((f) => !readMethods.includes(f) || FORCE_WRITE.has(f.name));

  if (readMethods.length > 0) {
    lines.push("  // ── Read Methods ────────────────────────────────────────────");
    lines.push("");
    for (const fn of readMethods) {
      const pascalName = snakeToPascal(fn.name);
      const returnType = fn.outputs[0]?.type ?? "void";
      const isOptional = returnType.endsWith(" | null");
      lines.push(
        `  async ${camelCase(fn.name)}(${generateParams(fn.inputs)}): Promise<${returnType}> {`
      );
      const args = fn.inputs
        .map((p) => argToScVal(p.name, p.type, knownTypes, p.sorobanType))
        .join(", ");
      lines.push(
        `    const retval = await this.simulateCall("${fn.name}"${args ? ", " + args : ""});`
      );
      if (returnType === "boolean") {
        lines.push("    if (!retval) return false;");
        lines.push("    return scValToNative(retval) as boolean;");
      } else if (returnType === "bigint") {
        lines.push("    if (!retval) return 0n;");
        lines.push("    return scValToNative(retval) as bigint;");
      } else if (returnType === "number") {
        lines.push("    if (!retval) return 0;");
        lines.push("    return scValToNative(retval) as number;");
      } else if (returnType === "string") {
        lines.push('    if (!retval) return "";');
        lines.push("    return scValToNative(retval) as string;");
      } else if (returnType.endsWith("[]")) {
        lines.push("    if (!retval) return [];");
        lines.push(`    return scValToNative(retval) as ${returnType};`);
      } else if (isOptional) {
        const innerType = returnType.replace(" | null", "");
        lines.push("    if (!retval) return null;");
        lines.push("    try {");
        lines.push("      const raw = scValToNative(retval);");
        lines.push(`      return raw == null ? null : (raw as ${innerType});`);
        lines.push("    } catch (e) {");
        lines.push("      if (e instanceof NotFoundError) return null;");
        lines.push("      throw e;");
        lines.push("    }");
      } else {
        lines.push("    if (!retval) throw new Error('No return value');");
        lines.push(`    return scValToNative(retval) as ${returnType};`);
      }
      lines.push("  }");
      lines.push("");
    }
  }

  if (writeMethods.length > 0) {
    lines.push("  // ── Write Methods (XDR envelope builders) ───────────────────");
    lines.push("");
    for (const fn of writeMethods) {
      const pascalName = snakeToPascal(fn.name);
      lines.push(`  ${camelCase(fn.name)}(${generateParams(fn.inputs)}): string {`);
      const args = fn.inputs
        .map((p) => argToScVal(p.name, p.type, knownTypes, p.sorobanType))
        .join(", ");
      lines.push(`    return this.buildTx("${fn.name}"${args ? ", " + args : ""});`);
      lines.push("  }");
      lines.push("");
    }
  }

  lines.push("}");
  lines.push("");

  return lines.join("\n");
}

function generateEvents(events: EventType[], structs: StructType[], enums: EnumType[]): string {
  const knownTypes = new Set([...structs.map((s) => s.name), ...enums.map((e) => e.name)]);
  const usedUdtTypes = new Set(
    events.flatMap((ev) =>
      [...ev.topicFields, ...ev.dataFields]
        .map((f) => f.type.replace("[]", "").replace(" | null", ""))
        .filter((t) => knownTypes.has(t))
    )
  );

  const lines: string[] = [
    "// Auto-generated by packages/codegen/generate.ts — do not edit manually.",
    "/* eslint-disable */",
    "",
    'import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";',
    ...(usedUdtTypes.size > 0
      ? [`import type { ${[...usedUdtTypes].join(", ")} } from "./types";`, ""]
      : [""]),
    "// ── Event type definitions ───────────────────────────────────────────",
    "",
  ];

  for (const ev of events) {
    lines.push(`export interface ${ev.name} {`);
    for (const f of ev.topicFields) {
      lines.push(`  ${f.name}: ${f.type};`);
    }
    for (const f of ev.dataFields) {
      lines.push(`  ${f.name}: ${f.type};`);
    }
    lines.push("}");
    lines.push("");
  }

  lines.push("// ── Event parser ─────────────────────────────────────────────");
  lines.push("");
  lines.push("export type LinkoraEvent =");
  for (const ev of events) {
    lines.push(`  | { type: "${ev.name}"; } & ${ev.name}`);
  }
  lines.push('  | { type: "unknown"; raw: xdr.ScVal }');
  lines.push(";");
  lines.push("");

  // Parser function
  lines.push("/**");
  lines.push(" * Parse a Soroban contract event into a typed LinkoraEvent.");
  lines.push(" * The event name in topics[0] is matched against known event types.");
  lines.push(" * Topic fields are read from topics[1..N], and data fields from the event value.");
  lines.push(" */");
  lines.push("export function parseContractEvent(");
  lines.push("  event: rpc.Api.Event,");
  lines.push("): LinkoraEvent | null {");
  lines.push("  if (!event.topic || event.topic.length < 1) return null;");
  lines.push("  const topic0 = event.topic[0];");
  lines.push("  const eventType = scValToNative(topic0);");
  lines.push('  const typeStr = typeof eventType === "string" ? eventType : String(eventType);');

  lines.push("  switch (typeStr) {");
  for (const ev of events) {
    const fullName = ev.name;
    lines.push(`    case "${fullName}":`);
    lines.push("      return {");
    lines.push(`        type: "${fullName}",`);
    // All params are extracted from topics starting at index 1
    let topicIdx = 1;
    for (const f of ev.topicFields) {
      lines.push(`        ${f.name}: scValToNative(event.topic[${topicIdx}]),`);
      topicIdx++;
    }
    if (ev.topicFields.length === 0) {
      lines.push("        // event has no fields");
    }
    lines.push("      };");
  }
  lines.push("    default:");
  lines.push('      return { type: "unknown", raw: event.value };');
  lines.push("  }");
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}

// ── Helpers ───────────────────────────────────────────────────────────────

function generateHelperFuncs(): string {
  return `
function scvAddress(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: "address" });
}

function scvString(value: string): xdr.ScVal {
  return nativeToScVal(value);
}

function scvSymbol(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: "symbol" });
}

function scvU32(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: "u32" });
}

function scvU64(value: number | bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "u64" });
}

function scvI128(value: number | bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "i128" });
}

function scvAddressVec(addresses: string[]): xdr.ScVal {
  return nativeToScVal(addresses.map(addr => Address.fromString(addr)), { type: "vec" });
}
`;
}

function snakeToPascal(s: string): string {
  return s
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function camelCase(s: string): string {
  const pascal = snakeToPascal(s);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function generateParams(inputs: FuncParam[]): string {
  return inputs.map((p) => `${p.name}: ${p.type}`).join(", ");
}

function argToScVal(
  name: string,
  type: string,
  knownTypes: Set<string>,
  sorobanType?: string
): string {
  if (!sorobanType) {
    // Fallback: try to infer from TS type
    if (type === "number") return `scvU32(${name})`;
    if (type === "bigint") return `scvI128(${name})`;
    if (type === "boolean") return `nativeToScVal(${name})`;
    if (type === "Uint8Array") return `nativeToScVal(${name}, { type: "bytes" })`;
    if (type.endsWith("[]")) return `nativeToScVal(${name}, { type: "vec" })`;
    if (knownTypes.has(type)) return `nativeToScVal(${name})`;
    return `nativeToScVal(${name})`;
  }

  switch (sorobanType) {
    case "address":
      return `scvAddress(${name})`;
    case "symbol":
      return `scvSymbol(${name})`;
    case "string":
      return `scvString(${name})`;
    case "u32":
    case "i32":
      return `scvU32(${name})`;
    case "u64":
    case "i64":
      return `scvU64(${name})`;
    case "i128":
    case "u128":
      return `scvI128(${name})`;
    case "bool":
      return `nativeToScVal(${name})`;
    case "bytes":
    case "bytesn":
      return `nativeToScVal(${name}, { type: "bytes" })`;
    case "vec": {
      // Check element type
      if (type === "string[]") return `scvAddressVec(${name})`;
      return `nativeToScVal(${name}, { type: "vec" })`;
    }
    case "option":
      return `nativeToScVal(${name})`;
    default:
      // UDT (custom struct/enum)
      return `nativeToScVal(${name})`;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

function main() {
  console.log("📦 Parsing contract ABI...");
  const { structs, enums, events, functions } = parseSpec();

  console.log(`  Structs: ${structs.length}`);
  console.log(`  Enums: ${enums.length}`);
  console.log(`  Events: ${events.length}`);
  console.log(`  Functions: ${functions.length}`);

  mkdirSync(OUT_DIR, { recursive: true });

  const typesContent = generateTypes(structs, enums);
  writeFileSync(resolve(OUT_DIR, "types.ts"), typesContent);
  console.log("  ✓ packages/sdk/src/generated/types.ts");

  // Also generate the barrier file
  writeFileSync(
    resolve(OUT_DIR, "index.ts"),
    [
      "// Auto-generated by packages/codegen/generate.ts — do not edit manually.",
      "/* eslint-disable */",
      "",
      'export * from "./types";',
      'export * from "./client";',
      'export * from "./events";',
      "",
    ].join("\n")
  );
  console.log("  ✓ packages/sdk/src/generated/index.ts");

  const clientContent = generateClient(functions, structs, enums);
  writeFileSync(resolve(OUT_DIR, "client.ts"), clientContent);
  console.log("  ✓ packages/sdk/src/generated/client.ts");

  const eventsContent = generateEvents(events, structs, enums);
  writeFileSync(resolve(OUT_DIR, "events.ts"), eventsContent);
  console.log("  ✓ packages/sdk/src/generated/events.ts");

  console.log("\n✅ Codegen complete.");
}

main();
