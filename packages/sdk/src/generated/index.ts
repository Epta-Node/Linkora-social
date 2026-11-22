// Hand-maintained legacy wrapper: `packages/codegen/generate.ts` no longer emits this file.
// Bindings generated from the contract ABI live in ./contracts/ (`pnpm codegen`).
/* eslint-disable */
/**
 * Barrier barrel for generated contract bindings.
 *
 * Tree-shaking contract (Epta-Node#1364): this file and everything it
 * re-exports are side-effect-free pure declarations, and the SDK package
 * declares `sideEffects: false`. Bundlers may therefore drop any
 * generated export an application does not use.
 */

export * from "./types.js";
export * from "./client.js";
export * from "./events.js";
