/**
 * Pool analytics route test.
 *
 * Verifies the analytics page component renders correctly for a given pool.
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import PoolAnalyticsPage from "@/app/pools/[id]/analytics/page";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "community" }),
  useRouter: () => ({ push: mockPush }),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("PoolAnalyticsPage", () => {
  it("renders loading skeleton initially", async () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<PoolAnalyticsPage />);
    const skeletons = container.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders error state on fetch failure", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    render(<PoolAnalyticsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Retry/i)).toBeInTheDocument();
    });
  });

  it("renders empty state for 404", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    render(<PoolAnalyticsPage />);
    await waitFor(() => {
      expect(screen.getByText(/No analytics data/i)).toBeInTheDocument();
    });
  });

  it("renders analytics dashboard with data", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        pool_id: "community",
        token: "GDQOE23CFSUMSVQK4Y5JHPPYK73VYCNHZHA7ENKCV37P6SUEO6XQBKPP",
        balance: "5000000000",
        admins: ["GAAA", "GBBB", "GCCC"],
        threshold: 2,
        created_ledger: 1000,
        total_deposited: "7000000000",
        total_withdrawn: "2000000000",
        contributor_count: 5,
        recent_events: [
          {
            type: "deposit",
            address: "GAAA",
            amount: "100000000",
            ledger: 1500,
            timestamp: "2025-01-15T10:00:00Z",
          },
          {
            type: "withdraw",
            address: "GBBB",
            amount: "50000000",
            ledger: 1490,
            timestamp: "2025-01-14T08:00:00Z",
          },
        ],
        volume_7d: "150000000",
        volume_30d: "300000000",
      }),
    });

    render(<PoolAnalyticsPage />);

    await waitFor(() => {
      expect(screen.getByText("Pool Analytics")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("Total Value Locked")).toBeInTheDocument();
      expect(screen.getByText("Contributors")).toBeInTheDocument();
      expect(screen.getByText("Total Deposited")).toBeInTheDocument();
      expect(screen.getByText("Net Flow")).toBeInTheDocument();
    });
  });
});
