import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { WalletSection } from "./WalletSection";

const mockDisconnect = jest.fn();
const mockPush = jest.fn();

jest.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({
    address: "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCD",
    network: "Testnet",
    disconnect: mockDisconnect,
  }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

describe("WalletSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should have no accessibility violations", async () => {
    const { container } = render(<WalletSection />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("should display wallet information", () => {
    render(<WalletSection />);

    expect(screen.getByText("Wallet")).toBeInTheDocument();
    expect(screen.getByText("Connected Address")).toBeInTheDocument();
    expect(screen.getByText("Network")).toBeInTheDocument();
    expect(screen.getByText("Testnet")).toBeInTheDocument();
  });

  it("should truncate address display", () => {
    render(<WalletSection />);
    const addressElement = screen.getByText(/GABC12...ABCD/);
    expect(addressElement).toBeInTheDocument();
  });

  it("should call disconnect and redirect when disconnect button is clicked", () => {
    render(<WalletSection />);

    const disconnectButton = screen.getByText("Disconnect Wallet");
    fireEvent.click(disconnectButton);

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/");
  });

  it("should copy address to clipboard", () => {
    const mockWriteText = jest.fn();
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    render(<WalletSection />);

    const copyButton = screen.getByText("Copy");
    fireEvent.click(copyButton);

    expect(mockWriteText).toHaveBeenCalledWith(
      "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCD"
    );
  });
});
