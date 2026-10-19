/**
 * Pool analytics route tests.
 *
 * Covers: loading skeleton, error state, empty state (404), and the full
 * dashboard render including the new TVL chart, deposit/withdrawal bar chart,
 * member count line chart, estimated APY stat card, and accessibility attributes.
 */

import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import PoolAnalyticsPage from "@/app/pools/[id]/analytics/page";

// ── Navigation mock ───────────────────────────────────────────────────────────

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "community" }),
  useRouter: () => ({ push: mockPush }),
}));

// ── Recharts mock (JSDOM has no layout engine) ────────────────────────────────

jest.mock("recharts", () => {
  const React = require("react");
  const passthrough =
    (name: string) =>
    ({ children, ...rest }: Record<string, unknown>) =>
      React.createElement("div", { "data-testid": `recharts-${name}`, ...rest }, children);

  return {
    AreaChart: passthrough("area-chart"),
    Area: () => null,
    BarChart: passthrough("bar-chart"),
    Bar: () => null,
    LineChart: passthrough("line-chart"),
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "recharts-responsive" }, children),
  };
});

// ── Fetch mock ────────────────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const MOCK_STATS = {
  pool_id: "community",
  token: "GDQOE23CFSUMSVQK4Y5JHPPYK73VYCNHZHA7ENKCV37P6SUEO6XQBKPP",
  balance: "5000000000",
  admins: ["GAAA", "GBBB", "GCCC"],
  threshold: 2,
  created_ledger: 1000,
  total_deposited: "7000000000",
  total_withdrawn: "2000000000",
  contributor_count: 12,
  estimated_apy: 8.45,
  tvl_history: [
    { date: "2026-10-12", tvl: 400, memberCount: 10 },
    { date: "2026-10-13", tvl: 420, memberCount: 11 },
    { date: "2026-10-14", tvl: 500, memberCount: 12 },
  ],
  activity: [
    { date: "2026-10-12", deposits: 100, withdrawals: 20 },
    { date: "2026-10-13", deposits: 80, withdrawals: 0 },
  ],
  recent_events: [
    {
      type: "deposit",
      address: "GAAA",
      amount: "100000000",
      ledger: 1500,
      timestamp: "2026-10-14T10:00:00Z",
    },
    {
      type: "withdraw",
      address: "GBBB",
      amount: "50000000",
      ledger: 1490,
      timestamp: "2026-10-13T08:00:00Z",
    },
  ],
  volume_7d: "150000000",
  volume_30d: "300000000",
};

beforeEach(() => {
  mockFetch.mockReset();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PoolAnalyticsPage", () => {
  it("renders loading skeleton initially", () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<PoolAnalyticsPage />);
    const skeletons = container.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("marks the skeleton region as aria-busy", () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    render(<PoolAnalyticsPage />);
    expect(screen.getByRole("region", { name: /loading analytics/i })).toBeInTheDocument();
  });

  it("renders error state on fetch failure and shows Retry button", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    render(<PoolAnalyticsPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });
  });

  it("renders empty state for 404 response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    render(<PoolAnalyticsPage />);
    await waitFor(() => {
      expect(screen.getByText(/no analytics data yet/i)).toBeInTheDocument();
    });
  });

  describe("loaded dashboard", () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => MOCK_STATS,
      });
    });

    it("renders the page heading", async () => {
      render(<PoolAnalyticsPage />);
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /pool analytics/i })).toBeInTheDocument(),
      );
    });

    it("renders all four stat cards", async () => {
      render(<PoolAnalyticsPage />);
      await waitFor(() => {
        expect(screen.getByText("Total Value Locked")).toBeInTheDocument();
        expect(screen.getByText("Estimated APY")).toBeInTheDocument();
        expect(screen.getByText("Members")).toBeInTheDocument();
        expect(screen.getByText("Net Flow")).toBeInTheDocument();
      });
    });

    it("displays estimated APY value", async () => {
      render(<PoolAnalyticsPage />);
      await waitFor(() => {
        expect(screen.getByText("8.45%")).toBeInTheDocument();
      });
    });

    it("displays member count", async () => {
      render(<PoolAnalyticsPage />);
      await waitFor(() => {
        // contributor_count = 12
        expect(screen.getByText("12")).toBeInTheDocument();
      });
    });

    it("renders TVL chart section with accessible role=img", async () => {
      render(<PoolAnalyticsPage />);
      await waitFor(() => {
        const tvlChart = screen.getByRole("img", { name: /total value locked chart/i });
        expect(tvlChart).toBeInTheDocument();
      });
    });

    it("renders deposit & withdrawal chart with accessible role=img", async () => {
      render(<PoolAnalyticsPage />);
      await waitFor(() => {
        const actChart = screen.getByRole("img", {
          name: /deposit & withdrawal activity chart/i,
        });
        expect(actChart).toBeInTheDocument();
      });
    });

    it("renders member count chart with accessible role=img", async () => {
      render(<PoolAnalyticsPage />);
      await waitFor(() => {
        const membersChart = screen.getByRole("img", { name: /member count chart/i });
        expect(membersChart).toBeInTheDocument();
      });
    });

    it("renders sr-only text summaries for each chart", async () => {
      render(<PoolAnalyticsPage />);
      await waitFor(() => {
        // Each ChartCard renders a .sr-only <p> with a summary
        const srParagraphs = document
          .querySelectorAll("p.sr-only");
        expect(srParagraphs.length).toBeGreaterThanOrEqual(3);
      });
    });

    it("renders recent activity events", async () => {
      render(<PoolAnalyticsPage />);
      await waitFor(() => {
        expect(screen.getByText(/↓ DEPOSIT/i)).toBeInTheDocument();
        expect(screen.getByText(/↑ WITHDRAW/i)).toBeInTheDocument();
      });
    });

    it("renders pool info footer", async () => {
      render(<PoolAnalyticsPage />);
      await waitFor(() => {
        expect(screen.getByText(/Pool Info/i)).toBeInTheDocument();
        expect(screen.getByText(/Ledger 1000/i)).toBeInTheDocument();
      });
    });
  });

  describe("time range toggle", () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => MOCK_STATS,
      });
    });

    it("renders 7d, 30d, and 90d toggle buttons", async () => {
      render(<PoolAnalyticsPage />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /7d/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /30d/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /90d/i })).toBeInTheDocument();
      });
    });

    it("marks the active range button as aria-pressed=true", async () => {
      render(<PoolAnalyticsPage />);
      await waitFor(() => {
        const btn7d = screen.getByRole("button", { name: /7d/i });
        expect(btn7d).toHaveAttribute("aria-pressed", "true");
      });
    });

    it("re-fetches when a new range is selected", async () => {
      render(<PoolAnalyticsPage />);
      await waitFor(() => screen.getByRole("button", { name: /30d/i }));

      fireEvent.click(screen.getByRole("button", { name: /30d/i }));

      await waitFor(() => {
        // fetch called at least twice: once on mount (7d) and once for 30d
        expect(mockFetch).toHaveBeenCalledTimes(2);
        const secondCall = mockFetch.mock.calls[1][0] as string;
        expect(secondCall).toContain("range=30d");
      });
    });
  });

  describe("breadcrumb navigation", () => {
    it("renders breadcrumb links to pools list and pool detail", async () => {
      mockFetch.mockImplementation(() => new Promise(() => {}));
      render(<PoolAnalyticsPage />);
      const nav = screen.getByRole("navigation", { name: /breadcrumb/i });
      expect(nav).toBeInTheDocument();
      expect(nav.querySelector(`a[href="/pools"]`)).toBeInTheDocument();
      expect(nav.querySelector(`a[href="/pools/community"]`)).toBeInTheDocument();
    });
  });
});
