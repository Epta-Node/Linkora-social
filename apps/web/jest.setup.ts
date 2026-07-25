// Jest setup file for DOM and React testing utilities
import "@testing-library/jest-dom";
import { toHaveNoViolations } from "jest-axe";

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

// Mock LinkoraClient
jest.mock("linkora-sdk", () => ({
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
}));

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
