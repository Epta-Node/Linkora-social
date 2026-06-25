import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { ProfileSection } from "./ProfileSection";

describe("ProfileSection", () => {
  const mockAddress = "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCD";

  it("should have no accessibility violations", async () => {
    const { container } = render(<ProfileSection address={mockAddress} />);

    await waitFor(() => {
      expect(screen.getByText("Profile")).toBeInTheDocument();
    });

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("should display profile form after loading", async () => {
    render(<ProfileSection address={mockAddress} />);

    await waitFor(() => {
      expect(screen.getByText("Profile")).toBeInTheDocument();
      expect(
        screen.getByText("Update your username and creator token settings.")
      ).toBeInTheDocument();
    });
  });

  it("should show success message after successful submission", async () => {
    render(<ProfileSection address={mockAddress} />);

    await waitFor(() => {
      expect(screen.getByText("Save Profile")).toBeInTheDocument();
    });

    const submitButton = screen.getByText("Save Profile");
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText("Profile updated successfully!")).toBeInTheDocument();
    });
  });
});
