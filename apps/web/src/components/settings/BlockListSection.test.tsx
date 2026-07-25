import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { BlockListSection } from "./BlockListSection";

const mockAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const otherAddress = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

describe("BlockListSection", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it("should have no accessibility violations", async () => {
    const { container } = render(<BlockListSection address={mockAddress} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("should display empty state when no accounts are blocked", () => {
    render(<BlockListSection address={mockAddress} />);
    expect(screen.getByText("No blocked accounts.")).toBeInTheDocument();
  });

  it("should load blocked accounts from localStorage", () => {
    localStorage.setItem("linkora_blocked_accounts", JSON.stringify([otherAddress]));
    render(<BlockListSection address={mockAddress} />);

    expect(screen.queryByText("No blocked accounts.")).not.toBeInTheDocument();
    expect(screen.getByText(otherAddress)).toBeInTheDocument();
  });

  it("should allow blocking a valid address on-chain", async () => {
    render(<BlockListSection address={mockAddress} />);

    const input = screen.getByPlaceholderText(/Enter Stellar address/);
    const blockButton = screen.getByText("Block Address");

    fireEvent.change(input, { target: { value: otherAddress } });
    fireEvent.click(blockButton);

    await waitFor(() => {
      expect(screen.getByText("Address blocked successfully.")).toBeInTheDocument();
    });

    expect(screen.getByText(otherAddress)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("linkora_blocked_accounts") || "[]")).toContain(
      otherAddress
    );
  });

  it("should show validation error for invalid address", () => {
    render(<BlockListSection address={mockAddress} />);

    const input = screen.getByPlaceholderText(/Enter Stellar address/);
    const blockButton = screen.getByText("Block Address");

    fireEvent.change(input, { target: { value: "INVALID" } });
    fireEvent.click(blockButton);

    expect(
      screen.getByText("Enter a valid Stellar address (starts with G or C, 56 characters).")
    ).toBeInTheDocument();
  });

  it("should allow unblocking a blocked address on-chain", async () => {
    localStorage.setItem("linkora_blocked_accounts", JSON.stringify([otherAddress]));
    render(<BlockListSection address={mockAddress} />);

    expect(screen.getByText(otherAddress)).toBeInTheDocument();

    const unblockButton = screen.getByText("Unblock");
    fireEvent.click(unblockButton);

    await waitFor(() => {
      expect(screen.getByText("Address unblocked successfully.")).toBeInTheDocument();
    });

    expect(screen.queryByText(otherAddress)).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("linkora_blocked_accounts") || "[]")).not.toContain(
      otherAddress
    );
  });

  it("should show error when same address is blocked twice", () => {
    localStorage.setItem("linkora_blocked_accounts", JSON.stringify([otherAddress]));
    render(<BlockListSection address={mockAddress} />);

    const input = screen.getByPlaceholderText(/Enter Stellar address/);
    const blockButton = screen.getByText("Block Address");

    fireEvent.change(input, { target: { value: otherAddress } });
    fireEvent.click(blockButton);

    expect(screen.getByText("Address is already blocked.")).toBeInTheDocument();
  });
});
