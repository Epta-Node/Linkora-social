// Jest setup file for DOM and React testing utilities
import "@testing-library/jest-dom";

process.env.NEXT_PUBLIC_SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
process.env.NEXT_PUBLIC_CONTRACT_ID = "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

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
