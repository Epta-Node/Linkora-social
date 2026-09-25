/** Shared typed event parser for all Linkora contracts. */
import { parseContractEvent, eventSource } from "./types.js";
import type { LinkoraEvent, SorobanEvent, EventSource } from "./types.js";

export type { LinkoraEvent, SorobanEvent, EventSource } from "./types.js";

export interface EventParserOptions {
  tokenFactoryId?: string;
}

export function parseEvent(
  raw: SorobanEvent,
  options: EventParserOptions = {}
): LinkoraEvent | null {
  return parseContractEvent(raw, options.tokenFactoryId);
}

export { eventSource };
