import { fireEvent, render, screen } from "@testing-library/react";
import GovernancePage from "./page";
import GovernanceLoading from "./loading";

const mockUseProposalList = jest.fn();

jest.mock("@/hooks/useGovernance", () => ({
  useProposalList: () => mockUseProposalList(),
}));

jest.mock("@/lib/governance", () => ({
  isGovernanceConfigured: () => true,
}));

jest.mock("@/components/governance/ProposalCard", () => ({
  ProposalCard: ({ proposal }: { proposal: { id: string; title: string } }) => (
    <article data-testid="proposal-card">{proposal.title}</article>
  ),
}));

describe("GovernancePage loading, empty, and error boundaries", () => {
  beforeEach(() => {
    mockUseProposalList.mockReset();
  });

  it("renders the route loading boundary skeleton", () => {
    render(<GovernanceLoading />);
    expect(screen.getByTestId("governance-loading")).toBeInTheDocument();
    expect(screen.getByTestId("governance-skeleton")).toBeInTheDocument();
  });

  it("shows skeleton loader while fetching proposals", () => {
    mockUseProposalList.mockReturnValue({
      proposals: [],
      loading: true,
      error: null,
      page: 1,
      hasNext: false,
      hasPrev: false,
      next: jest.fn(),
      previous: jest.fn(),
      refresh: jest.fn(),
    });

    render(<GovernancePage />);
    expect(screen.getByTestId("governance-skeleton")).toBeInTheDocument();
  });

  it("shows empty state when no proposals exist", () => {
    mockUseProposalList.mockReturnValue({
      proposals: [],
      loading: false,
      error: null,
      page: 1,
      hasNext: false,
      hasPrev: false,
      next: jest.fn(),
      previous: jest.fn(),
      refresh: jest.fn(),
    });

    render(<GovernancePage />);
    expect(screen.getByText(/No proposals have been created yet/i)).toBeInTheDocument();
  });

  it("shows error state with retry button", () => {
    const refresh = jest.fn();
    mockUseProposalList.mockReturnValue({
      proposals: [],
      loading: false,
      error: "Failed to load proposals",
      page: 1,
      hasNext: false,
      hasPrev: false,
      next: jest.fn(),
      previous: jest.fn(),
      refresh,
    });

    render(<GovernancePage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load proposals");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
