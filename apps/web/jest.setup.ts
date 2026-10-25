// jsdom does not expose the WHATWG classes that Next's server helpers
// (NextRequest, route handlers, server actions) rely on. Install Node's own
// spec-compliant implementations (undici backs Node's global fetch) rather
// than a browser shim: NextRequest extends the global Request, and shims such
// as whatwg-fetch assign `this.url`, which NextRequest defines as a getter.
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "util";
import { ReadableStream, TransformStream, WritableStream } from "node:stream/web";

const globals = globalThis as Record<string, unknown>;

globals.TextEncoder ??= NodeTextEncoder;
globals.TextDecoder ??= NodeTextDecoder;
globals.ReadableStream ??= ReadableStream;
globals.WritableStream ??= WritableStream;
globals.TransformStream ??= TransformStream;

// undici reads TextEncoder when its module is evaluated, so it has to be
// required *after* the globals above are installed — a static import would be
// hoisted above them.
const undici = require("undici") as typeof import("undici");

globals.Request ??= undici.Request;
globals.Response ??= undici.Response;
globals.Headers ??= undici.Headers;
globals.fetch ??= undici.fetch;
globals.FormData ??= undici.FormData;

// Jest setup file for DOM and React testing utilities
import "@testing-library/jest-dom";
import { toHaveNoViolations } from "jest-axe";
import { TextEncoder, TextDecoder } from "util";

(globalThis as any).TextEncoder = (globalThis as any).TextEncoder || TextEncoder;
(globalThis as any).TextDecoder = (globalThis as any).TextDecoder || TextDecoder;

// Extend Jest matchers with jest-axe
expect.extend(toHaveNoViolations);

// Mock window.matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as unknown as typeof IntersectionObserver;

// Mock Notification API
Object.defineProperty(window, "Notification", {
  writable: true,
  value: {
    permission: "default",
    requestPermission: jest.fn().mockResolvedValue("granted"),
  },
});

// @vercel/analytics ships ESM-only builds that Jest cannot parse without a
// transform; the component performs no work needed by unit tests.
jest.mock("@vercel/analytics/react", () => ({
  Analytics: () => null,
}));

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock LinkoraClient and linkora-sdk utilities
jest.mock("linkora-sdk", () => {
  const actual = jest.requireActual("linkora-sdk");
  return {
    ...actual,
    LinkoraClient: jest.fn().mockImplementation(() => ({
      getProfile: jest.fn().mockResolvedValue({
        username: "testuser",
        creator_token: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      }),
      getDmKey: jest.fn().mockResolvedValue(null),
      setProfile: jest.fn().mockReturnValue("mockXDR"),
      publishDmKey: jest.fn().mockReturnValue("mockXDR"),
      deleteProfile: jest.fn().mockReturnValue("mockXDR"),
      blockUser: jest.fn().mockReturnValue("mockXDR"),
      unblockUser: jest.fn().mockReturnValue("mockXDR"),
    })),
    generateDmKeypair: jest.fn().mockReturnValue({
      publicKey: new Uint8Array(32),
      privateKey: new Uint8Array(32),
    }),
    utf8Bytes: (value: string) => Buffer.from(value, "utf8").length,
  };
});

// Mock @stellar/stellar-sdk
jest.mock("@stellar/stellar-sdk", () => ({
  Transaction: jest.fn().mockImplementation(() => ({})),
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      sendTransaction: jest.fn().mockResolvedValue({ status: "PENDING", hash: "mockHash" }),
      getTransaction: jest.fn().mockResolvedValue({ status: "SUCCESS" }),
    })),
  },
}));

// Mock @stellar/freighter-api
jest.mock("@stellar/freighter-api", () => ({
  signTransaction: jest.fn().mockResolvedValue("mockSignedXdr"),
  isConnected: jest.fn().mockResolvedValue(true),
  getPublicKey: jest
    .fn()
    .mockResolvedValue("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
  getNetwork: jest.fn().mockResolvedValue("TESTNET"),
  requestAccess: jest
    .fn()
    .mockResolvedValue("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
}));
