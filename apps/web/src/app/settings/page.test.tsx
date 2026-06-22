import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import SettingsPage from "./page";

// Mock useWallet hook
const mockUseWallet = jest.fn();
jest.mock("@/hooks/useWallet", () => ({
  useWallet: () => mockUseWallet(),
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

describe("SettingsPage", () => {
  const mockAddress = "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCD";

  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  describe("Accessibility", () => {
    it("should have no accessibility violations when connected", async () => {
      mockUseWallet.mockReturnValue({
        address: mockAddress,
        connected: true,
        network: "Testnet",
        disconnect: jest.fn(),
      });

      const { container } = render(<SettingsPage />);

      // Wait for all async content to load
      await waitFor(() => {
        expect(screen.getByText("Settings")).toBeInTheDocument();
      });

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("should have no accessibility violations when not connected", async () => {
      mockUseWallet.mockReturnValue({
        address: null,
        connected: false,
        network: null,
        disconnect: jest.fn(),
      });

      const { container } = render(<SettingsPage />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe("Wallet Not Connected", () => {
    it("should display connect wallet message when not connected", () => {
      mockUseWallet.mockReturnValue({
        address: null,
        connected: false,
        network: null,
        disconnect: jest.fn(),
      });

      render(<SettingsPage />);
      expect(
        screen.getByText("Connect your wallet to access settings.")
      ).toBeInTheDocument();
    });

    it("should not render settings sections when not connected", () => {
      mockUseWallet.mockReturnValue({
        address: null,
        connected: false,
        network: null,
        disconnect: jest.fn(),
      });

      render(<SettingsPage />);
      expect(screen.queryByText("Profile")).not.toBeInTheDocument();
      expect(screen.queryByText("Wallet")).not.toBeInTheDocument();
    });
  });

  describe("Wallet Connected", () => {
    beforeEach(() => {
      mockUseWallet.mockReturnValue({
        address: mockAddress,
        connected: true,
        network: "Testnet",
        disconnect: jest.fn(),
      });
    });

    it("should render all settings sections", async () => {
      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByText("Settings")).toBeInTheDocument();
      });

      expect(screen.getByText("Profile")).toBeInTheDocument();
      expect(screen.getByText("Wallet")).toBeInTheDocument();
      expect(screen.getByText("Direct Messages")).toBeInTheDocument();
      expect(screen.getByText("Notifications")).toBeInTheDocument();
      expect(screen.getByText("Governance")).toBeInTheDocument();
      expect(screen.getByText("Danger Zone")).toBeInTheDocument();
    });

    it("should have proper heading hierarchy", async () => {
      render(<SettingsPage />);

      await waitFor(() => {
        expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
      });

      const h2Headings = screen.getAllByRole("heading", { level: 2 });
      expect(h2Headings.length).toBeGreaterThan(0);
    });
  });
});
