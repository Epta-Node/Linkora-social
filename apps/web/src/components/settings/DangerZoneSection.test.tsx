import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { DangerZoneSection } from "./DangerZoneSection";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

describe("DangerZoneSection", () => {
  const mockAddress = "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCD";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should have no accessibility violations", async () => {
    const { container } = render(<DangerZoneSection address={mockAddress} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("should display danger zone warning", () => {
    render(<DangerZoneSection address={mockAddress} />);

    expect(screen.getByText("Danger Zone")).toBeInTheDocument();
    expect(screen.getByText("Irreversible actions. Proceed with caution.")).toBeInTheDocument();
    expect(screen.getAllByText("Delete Profile").length).toBeGreaterThan(0);
  });

  it("should open confirmation dialog when delete is clicked", () => {
    render(<DangerZoneSection address={mockAddress} />);

    const deleteButton = screen.getAllByRole("button", { name: "Delete Profile" })[0];
    fireEvent.click(deleteButton);

    expect(screen.getByText("Delete Profile?")).toBeInTheDocument();
    expect(screen.getByText(/This will permanently delete your profile/)).toBeInTheDocument();
  });

  it("should have no accessibility violations in confirmation dialog", async () => {
    const { container } = render(<DangerZoneSection address={mockAddress} />);

    const deleteButton = screen.getAllByRole("button", { name: "Delete Profile" })[0];
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(screen.getByText("Delete Profile?")).toBeInTheDocument();
    });

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("should require exact address match for deletion", () => {
    render(<DangerZoneSection address={mockAddress} />);

    const deleteButton = screen.getAllByRole("button", { name: "Delete Profile" })[0];
    fireEvent.click(deleteButton);

    const input = screen.getByPlaceholderText(mockAddress);
    const confirmButton = screen.getAllByRole("button", { name: "Delete Profile" })[1];

    // Initially disabled
    expect(confirmButton).toBeDisabled();

    // Wrong address
    fireEvent.change(input, { target: { value: "WRONG_ADDRESS" } });
    expect(confirmButton).toBeDisabled();

    // Correct address
    fireEvent.change(input, { target: { value: mockAddress } });
    expect(confirmButton).not.toBeDisabled();
  });

  it("should show error when address doesn't match", async () => {
    render(<DangerZoneSection address={mockAddress} />);

    const deleteButton = screen.getAllByRole("button", { name: "Delete Profile" })[0];
    fireEvent.click(deleteButton);

    const input = screen.getByPlaceholderText(mockAddress);
    fireEvent.change(input, { target: { value: "WRONG_ADDRESS" } });

    const confirmButton = screen.getAllByRole("button", { name: "Delete Profile" })[1];
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(screen.getByText(/Address does not match/)).toBeInTheDocument();
    });
  });

  it("should close dialog when cancel is clicked", () => {
    render(<DangerZoneSection address={mockAddress} />);

    const deleteButton = screen.getAllByRole("button", { name: "Delete Profile" })[0];
    fireEvent.click(deleteButton);

    expect(screen.getByText("Delete Profile?")).toBeInTheDocument();

    const cancelButton = screen.getByText("Cancel");
    fireEvent.click(cancelButton);

    expect(screen.queryByText("Delete Profile?")).not.toBeInTheDocument();
  });

  it("should have proper form labels and accessibility attributes", () => {
    render(<DangerZoneSection address={mockAddress} />);

    const deleteButton = screen.getAllByRole("button", { name: "Delete Profile" })[0];
    fireEvent.click(deleteButton);

    const input = screen.getByLabelText(/Type your wallet address to confirm/);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("placeholder", mockAddress);
  });
});
