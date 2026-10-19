import { render, screen, waitFor, within } from "@testing-library/react";
import AnalyticsPage from "../analytics/page";
import { useWallet } from "@/hooks/useWallet";
import { fetchPosts, fetchAttestation, computeAnalytics } from "@/lib/analytics";

jest.mock("@/hooks/useWallet", () => ({ useWallet: jest.fn() }));
jest.mock("@/lib/analytics", () => ({
  fetchPosts: jest.fn(),
  fetchAttestation: jest.fn(),
  computeAnalytics: jest.fn(),
  generateCSV: jest.fn(),
  dateRangeToLedgerRange: jest.fn(() => ({ start: 0, end: 1 })),
}));
// Recharts needs real layout; render chart containers as plain boxes.
jest.mock("recharts", () => {
  const Box = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: ({ height, children }: { height: number; children?: React.ReactNode }) => (
      <div data-testid="chart" style={{ height }}>
        {children}
      </div>
    ),
    LineChart: Box,
    BarChart: Box,
    Line: () => null,
    Bar: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
  };
});

const DATA = {
  summary: {
    totalTipsXlm: "12.5",
    totalPosts: 3,
    totalLikes: 9,
    followerCount: 4,
    uniqueTippers: 2,
  },
  engagementOverTime: [],
  followerGrowth: [],
  tipEarnings: [],
  topPosts: [{ id: 1, likes: 5, tips: 2, score: 9 }],
  attestation: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  (useWallet as jest.Mock).mockReturnValue({ address: "GCREATOR", connected: true });
  (fetchAttestation as jest.Mock).mockResolvedValue(null);
  (computeAnalytics as jest.Mock).mockReturnValue(DATA);
});

afterEach(() => jest.clearAllMocks());

describe("Analytics page skeletons (#1635)", () => {
  it("renders a skeleton for every widget while loading", () => {
    (fetchPosts as jest.Mock).mockReturnValue(new Promise(() => {}));
    render(<AnalyticsPage />);

    const skeleton = screen.getByTestId("analytics-skeleton");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(
      within(screen.getByTestId("skeleton-summary")).getAllByText(
        /Total Tips|Posts|Likes|Followers|Unique Tippers/
      )
    ).toHaveLength(5);
    for (const key of ["engagement", "followers", "tips"]) {
      expect(screen.getByTestId(`skeleton-chart-${key}`)).toHaveStyle({ height: "300px" });
    }
    expect(screen.getByTestId("skeleton-top-posts")).toBeInTheDocument();
    expect(screen.getByTestId("skeleton-top-tippers")).toBeInTheDocument();
  });

  it("mirrors the loaded layout: same cards, titles and chart heights", async () => {
    const posts = deferred<unknown[]>();
    (fetchPosts as jest.Mock).mockReturnValue(posts.promise);
    const { container } = render(<AnalyticsPage />);

    const titlesWhileLoading = [...container.querySelectorAll("h3")].map((h) => h.textContent);
    posts.resolve([{ id: 1 }]);
    await waitFor(() => expect(screen.queryByTestId("analytics-skeleton")).not.toBeInTheDocument());

    expect([...container.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(
      titlesWhileLoading
    );
    expect(screen.getAllByTestId("chart").map((c) => c.style.height)).toEqual([
      "300px",
      "300px",
      "300px",
    ]);
    expect(screen.getByText("12.5 XLM")).toBeInTheDocument();
  });

  it("replaces the skeleton with the error state on failure", async () => {
    (fetchPosts as jest.Mock).mockRejectedValue(new Error("Indexer unavailable"));
    render(<AnalyticsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Indexer unavailable");
    expect(screen.queryByTestId("analytics-skeleton")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
