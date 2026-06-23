import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { DmKeySection } from "./DmKeySection";

describe("DmKeySection", () => {
  const mockAddress = "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCD";

  beforeEach(() => {
    localStorage.clear();
  });

  it("should have no accessibility violations without DM key", async () => {
    const { container } = render(<DmKeySection address={mockAddress} />);

    await waitFor(() => {
      expect(screen.getByText("Direct Messages")).toBeInTheDocument();
    });

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("should display publish DM key option when no key exists", async () => {
    render(<DmKeySection address={mockAddress} />);

    await waitFor(() => {
      expect(screen.getByText("Publish DM Key")).toBeInTheDocument();
      expect(screen.getByText(/You haven't published a DM key yet/)).toBeInTheDocument();
    });
  });

  it("should handle DM key publication", async () => {
    render(<DmKeySection address={mockAddress} />);

    await waitFor(() => {
      expect(screen.getByText("Publish DM Key")).toBeInTheDocument();
    });

    const publishButton = screen.getByText("Publish DM Key");
    fireEvent.click(publishButton);

    await waitFor(() => {
      expect(screen.getByText("Publishing Key...")).toBeInTheDocument();
    });
  });

  it("should show rotate option when key exists", async () => {
    // Mock getDmKey to return a key
    const { LinkoraClient } = require("linkora-sdk");
    LinkoraClient.mockImplementation(() => ({
      getDmKey: jest.fn().mockResolvedValue("existingKey"),
    }));

    render(<DmKeySection address={mockAddress} />);

    await waitFor(() => {
      expect(screen.getByText("DM Key Active")).toBeInTheDocument();
      expect(screen.getByText("Rotate Key")).toBeInTheDocument();
    });
  });
});
