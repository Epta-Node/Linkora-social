import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { WalletModal } from "../modals/WalletModal";
import { clearBalanceCache } from "../../hooks/useTokenBalances";

const MOCK_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const MOCK_NETWORK = "TESTNET";

const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockClipboard = {
  writeText: jest.fn().mockResolvedValue(undefined),
};
Object.assign(navigator, { clipboard: mockClipboard });

beforeEach(() => {
  jest.clearAllMocks();
  clearBalanceCache();
  mockFetch.mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("coingecko")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ stellar: { usd: 0.12 } }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          balances: [
            { asset_type: "native", balance: "100.50" },
            {
              asset_type: "credit_alphanum4",
              asset_code: "USDC",
              asset_issuer: "GDCISQG4K77K4E45ON22JBAQY2SE7LITL6Y7RWU6QCN5IJNXCEJGV677",
              balance: "250.00",
            },
          ],
        }),
    });
  });
});

function renderModal(overrides = {}) {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    address: MOCK_ADDRESS,
    network: MOCK_NETWORK,
    onDisconnect: jest.fn(),
    ...overrides,
  };

  return { ...defaultProps, ...render(<WalletModal {...defaultProps} />) };
}

describe("WalletModal", () => {
  it("renders nothing when isOpen is false", () => {
    renderModal({ isOpen: false });
    expect(screen.queryByTestId("wallet-modal")).not.toBeInTheDocument();
  });

  it("renders the modal when isOpen is true", async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByTestId("wallet-modal")).toBeInTheDocument();
    });
  });

  it("displays the wallet title", async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByText("Wallet")).toBeInTheDocument();
    });
  });

  it("displays the wallet address in truncated format", async () => {
    renderModal();
    const truncated = `${MOCK_ADDRESS.slice(0, 6)}...${MOCK_ADDRESS.slice(-4)}`;
    await waitFor(() => {
      expect(screen.getByText(truncated)).toBeInTheDocument();
    });
  });

  it("displays the network", async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByText("TESTNET")).toBeInTheDocument();
    });
  });

  it("calls onClose when close button is clicked", async () => {
    const { onClose } = renderModal();
    const closeBtn = await screen.findByLabelText("Close wallet modal");
    await act(async () => {
      fireEvent.click(closeBtn);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when cancel button is clicked", async () => {
    const { onClose } = renderModal();
    const cancelBtn = await screen.findByText("Cancel");
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onDisconnect and onClose when disconnect is clicked", async () => {
    const { onDisconnect, onClose } = renderModal();
    const disconnectBtn = await screen.findByText("Disconnect");
    fireEvent.click(disconnectBtn);
    expect(onDisconnect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("copies wallet address to clipboard on copy click", async () => {
    renderModal();
    const copyBtn = await screen.findByText("Copy");

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(mockClipboard.writeText).toHaveBeenCalledWith(MOCK_ADDRESS);
    await waitFor(() => {
      expect(screen.getByText("Copied")).toBeInTheDocument();
    });
  });

  it("fetches and displays token balances from Horizon", async () => {
    await act(async () => {
      renderModal();
    });

    await waitFor(
      () => {
        expect(screen.getByText("XLM")).toBeInTheDocument();
      },
      { timeout: 5000 }
    );

    expect(screen.getByText("USDC")).toBeInTheDocument();
  });

  it("displays loading state while fetching balances", async () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    renderModal();

    await waitFor(() => {
      expect(screen.getByText("Loading balances...")).toBeInTheDocument();
    });
  });

  it("displays error state when fetch fails", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("coingecko")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: false, status: 500 });
    });
    renderModal();
    await waitFor(() => {
      expect(screen.getByText(/Horizon returned 500/)).toBeInTheDocument();
    });
  });

  it("displays 'No token balances found' when response has empty balances", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("coingecko")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ balances: [] }),
      });
    });
    renderModal();
    await waitFor(() => {
      expect(screen.getByText("No token balances found")).toBeInTheDocument();
    });
  });

  it("does not fetch balances when isOpen is false", () => {
    renderModal({ isOpen: false });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
