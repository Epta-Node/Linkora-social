import { readFileSync, existsSync } from "fs";
import { gzipSync } from "zlib";
import path from "path";

/**
 * Bundle-size budget for the SDK (Epta-Node#1364).
 *
 * The SDK is imported by the web and mobile apps, so every generated or
 * hand-written module it re-exports lands in consumer bundles unless the
 * consumer tree-shakes it away. This suite enforces two invariants:
 *
 * 1. **Size budget** — the gzipped size of the SDK's own reachable source
 *    graph (walked from `src/index.ts`) stays under the budget in
 *    `bundle-size-budget.json`. It grows when new files are added to the
 *    entry graph, so it catches "large generated artifacts shipped to
 *    clients" regressions before they reach CI.
 * 2. **Tree-shaking contract** — the package declares `sideEffects: false`
 *    and the generated barrel (`src/generated/index.ts`) plus every
 *    generated module it re-exports are side-effect-free, so consumers that
 *    import a single symbol do not pay for the rest.
 *
 * The metric intentionally covers the SDK's own source only; third-party
 * dependencies (@stellar/*) are measured separately by consumers' bundlers.
 */

const SDK_ROOT = path.resolve(__dirname, "../..");
const BUDGET_FILE = path.join(SDK_ROOT, "bundle-size-budget.json");

interface ModuleGraph {
  files: string[];
  totalGzipBytes: number;
}

function resolveLocalSpec(sdkSrc: string, spec: string): string | null {
  // Source files use ESM-style ".js" specifiers for relative imports.
  const asTs = spec.replace(/\.js$/, ".ts");
  const abs = path.resolve(sdkSrc, asTs);
  if (existsSync(abs)) return abs;
  // Bare-directory specifiers resolve to their index module.
  const index = path.join(abs, "index.ts");
  if (existsSync(index)) return index;
  return null;
}

function walkModuleGraph(entry: string): ModuleGraph {
  const sdkSrc = path.join(SDK_ROOT, "src");
  const seen = new Set<string>();
  const files: string[] = [];
  let totalGzipBytes = 0;

  const walk = (spec: string): void => {
    const abs = resolveLocalSpec(sdkSrc, spec);
    if (!abs || seen.has(abs)) return;
    seen.add(abs);
    const buf = readFileSync(abs);
    totalGzipBytes += gzipSync(buf).length;
    files.push(path.relative(sdkSrc, abs));
    const source = buf.toString("utf8");
    const importRe = /(?:from|import)\s+['"](\.[^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = importRe.exec(source))) {
      walk(match[1]);
    }
  };

  walk(entry);
  return { files, totalGzipBytes };
}

describe("SDK bundle-size budget (Epta-Node#1364)", () => {
  let graph: ModuleGraph;
  let budgetKbGzip: number;

  beforeAll(() => {
    graph = walkModuleGraph("./index.ts");
    budgetKbGzip = JSON.parse(readFileSync(BUDGET_FILE, "utf8")).budgetKbGzip;
  });

  it("walks the SDK entry graph and keeps its gzipped size within budget", () => {
    expect(graph.files.length).toBeGreaterThan(0);

    if (graph.totalGzipBytes > budgetKbGzip * 1024) {
      const breakdown = graph.files
        .map((file) => {
          const gz = gzipSync(readFileSync(path.join(SDK_ROOT, "src", file))).length;
          return `  ${String(gz).padStart(7)}  ${file}`;
        })
        .join("\n");
      throw new Error(
        `SDK source graph is ${graph.totalGzipBytes} gzip bytes; budget is ` +
          `${budgetKbGzip} KiB. Generated or hand-written exports have grown.\n` +
          `Per-file gzipped sizes:\n${breakdown}\n` +
          `Reduce generated surface, or raise the budget in bundle-size-budget.json` +
          ` with justification in the PR description.`,
      );
    }
  });

  it("declares sideEffects: false so consumers can tree-shake the SDK", () => {
    const pkg = JSON.parse(readFileSync(path.join(SDK_ROOT, "package.json"), "utf8"));
    expect(pkg.sideEffects).toBe(false);
  });

  it("generated barrel and its re-exports are side-effect-free", () => {
    // Files that are part of the generated surface must not execute anything
    // at import time — otherwise `sideEffects: false` would be a lie and
    // bundlers would be forced to keep every generated module.
    //
    // We check every top-level (column-0) statement: generated files may only
    // contain pure declarations (imports, exports, consts, functions,
    // classes, interfaces, types, enums). Anything that runs at import time
    // (IIFEs, logging, global mutation) is a tree-shaking hazard.
    const importOrExport = /^(?:import|export)\b/;
    const pureDeclaration =
      /^(?:abstract\s+|async\s+|declare\s+)*(?:class|interface|type|enum|const|let|var|function)\b/;
    const closer = /^[)}\]|,;]+\s*$/;

    for (const rel of ["generated/index.ts", "generated/client.ts", "generated/events.ts", "generated/contract-parity.ts"]) {
      const source = readFileSync(path.join(SDK_ROOT, "src", rel), "utf8");
      const stripped = source
        .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
        .replace(/\/\/[^\n]*/g, ""); // line comments

      for (const rawLine of stripped.split("\n")) {
        const line = rawLine.replace(/\s+$/, "");
        if (!line.trim()) continue;
        // Only inspect column-0 lines — nested declarations (class members,
        // method bodies) are part of the surrounding declaration.
        if (/^\s/.test(line)) continue;
        if (importOrExport.test(line) || pureDeclaration.test(line) || closer.test(line)) continue;
        throw new Error(
          `${rel} contains a top-level statement that is not a pure declaration: "${line.trim()}". ` +
            "Generated files must stay side-effect-free for tree-shaking (Epta-Node#1364).",
        );
      }
    }
  });

  it("generated barrier only re-exports tree-shakable modules", () => {
    const barrel = readFileSync(path.join(SDK_ROOT, "src/generated/index.ts"), "utf8");
    // Every re-export must be a bare `export *` (drop-able) — no `export const`
    // side-effectful bindings in the barrier.
    const reExports = barrel.match(/^export \* from "\.\/[a-z-]+\.js";$/gm) ?? [];
    expect(reExports.length).toBeGreaterThanOrEqual(3);
    expect(barrel).not.toMatch(/^export (?!type \{|\* from)/m);
  });
});
