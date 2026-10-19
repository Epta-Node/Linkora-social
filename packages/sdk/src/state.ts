import { Buffer } from "buffer";

/**
 * Standardized interface for the Linkora contract global state.
 */
export interface ContractState {
  version: number;
  implementation_wasm_hash?: Buffer | null;
}
