import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { GovernanceSection } from "./GovernanceSection";

describe("GovernanceSection", () => {
  const mockAddress = "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCD";

  it("should have no accessibility violations", async () => {
    const { container } = render(<GovernanceSection address={mockAddress} />);

    await waitFor(() => {
      expect(screen.getByText("Governance")).toBeInTheDocument();
    });

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("should display governance section", async () => {
    render(<GovernanceSection address={mockAddress} />);

    await waitFor(() => {
      expect(screen.getByText("Governance")).toBeInTheDocument();
      expect(screen.getByText(/View and participate in active proposals/)).toBeInTheDocument();
    });
  });

  it("should display active proposals", async () => {
    render(<GovernanceSection address={mockAddress} />);

    await waitFor(() => {
      expect(screen.getByText("Reduce platform fee from 2.5% to 2%")).toBeInTheDocument();
      expect(screen.getByText("Add support for custom tokens in pools")).toBeInTheDocument();
    });
  });

  it("should show vote counts and progress bars", async () => {
    render(<GovernanceSection address={mockAddress} />);

    await waitFor(() => {
      expect(screen.getByText("For: 1250")).toBeInTheDocument();
      expect(screen.getByText("Against: 430")).toBeInTheDocument();
    });
  });

  it("should display time remaining for proposals", async () => {
    render(<GovernanceSection address={mockAddress} />);

    await waitFor(() => {
      const timeElements = screen.getAllByText(/remaining|Ending soon/);
      expect(timeElements.length).toBeGreaterThan(0);
    });
  });

  it("should have links to view individual proposals", async () => {
    render(<GovernanceSection address={mockAddress} />);

    await waitFor(() => {
      const voteLinks = screen.getAllByText("Vote →");
      expect(voteLinks.length).toBeGreaterThan(0);
      voteLinks.forEach((link) => {
        expect(link.closest("a")).toHaveAttribute("href");
      });
    });
  });

  it("should have link to view all proposals", async () => {
    render(<GovernanceSection address={mockAddress} />);

    await waitFor(() => {
      const viewAllLink = screen.getByText("View All Proposals →");
      expect(viewAllLink.closest("a")).toHaveAttribute("href", "/governance");
    });
  });
});
