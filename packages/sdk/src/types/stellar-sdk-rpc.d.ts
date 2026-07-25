/**
 * Ambient module declaration for the @stellar/stellar-sdk "./rpc" subpath export.
 *
 * The package's package.json "exports" map resolves "./rpc" to
 * "./lib/rpc/index.d.ts", but this project's tsconfig uses classic Node
 * module resolution (required to keep CommonJS output compatible with
 * plain `require` consumers), which does not consult "exports" maps.
 * The top-level package's own `rpc` named export has the identical shape
 * (it's how the package itself re-exports the submodule), so re-declaring
 * the subpath in terms of it lets TypeScript resolve the import without
 * switching the whole package to node16/bundler resolution.
 *
 * Location: packages/sdk/src/types/stellar-sdk-rpc.d.ts
 */
declare module "@stellar/stellar-sdk/rpc" {
  import { rpc } from "@stellar/stellar-sdk";
  export = rpc;
}
