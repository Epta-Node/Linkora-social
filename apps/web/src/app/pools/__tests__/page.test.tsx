import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import PoolsPage from "../page";
import { useAllPools, useTokenMeta } from "@/hooks/usePools";
import { useWallet } from "@/hooks/useWallet";

jest.mock("@/hooks/usePools", () => ({
  useAllPools: jest.fn(),
  useTokenMeta: jest.fn(),
  truncateAddress: (addr: string) => addr.slice(0, 6) + "..." + addr.slice(-4),
  formatTokenAmount: (amount: bigint) => amount.toString(),
}));

jest.mock("@/hooks/useWallet", () => ({
  useWallet: jest.fn(),
}));

const mockUseAllPools = useAllPools as jest.Mock;
const mockUseTokenMeta = useTokenMeta as jest.Mock;
const mockUseWallet = useWallet as jest.Mock;

const samplePools = [
  {
    pool_id: "pool-alpha",
    token: "CAS3JTV7C00000000000000000000000000000000000000000000000",
    balance: BigInt(5000),
    admins: ["GB111111111111111111111111111111111111111111111111111111"],
    threshold: 1,
  },
  {
    pool_id: "pool-beta",
    token: "CBT22222220000000000000000000000000000000000000000000000",
    balance: BigInt(0),
    admins: [
      "GB111111111111111111111111111111111111111111111111111111",
      "GB222222222222222222222222222222222222222222222222222222",
      "GB333333333333333333333333333333333333333333333333333333",
    ],
    threshold: 2,
  },
  {
    pool_id: "pool-gamma",
    token: "CGM33333330000000000000000000000000000000000000000000000",
    balance: BigInt(20000),
    admins: [
      "GB444444444444444444444444444444444444444444444444444444",
      "GB555555555555555555555555555555555555555555555555555555",
    ],
    threshold: 2,
  },
];

describe("PoolsPage (Community Pool Discovery)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseTokenMeta.mockReturnValue({ symbol: "TEST", decimals: 7, name: "Test Token" });
    mockUseWallet.mockReturnValue({
      address: "GB111111111111111111111111111111111111111111111111111111",
      connected: true,
    });
    mockUseAllPools.mockReturnValue({
      pools: samplePools,
      state: "success",
      error: null,
      isStale: false,
      refresh: jest.fn(),
    });
  });

  it("renders page header, create button, and pool cards", () => {
    render(<PoolsPage />);
    expect(screen.getByRole("heading", { name: /community pools/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create.*pool/i })).toBeInTheDocument();
    expect(screen.getByText(/3 pools found/i)).toBeInTheDocument();
  });

  it("filters pools by Open status (balance > 0)", () => {
    render(<PoolsPage />);
    const openBtn = screen.getByRole("button", { name: /^open$/i });
    fireEvent.click(openBtn);

    expect(screen.getByText(/2 pools found/i)).toBeInTheDocument();
    expect(screen.getByText(/pool-alpha/i)).toBeInTheDocument();
    expect(screen.getByText(/pool-gamma/i)).toBeInTheDocument();
    expect(screen.queryByText(/pool-beta/i)).not.toBeInTheDocument();
  });

  it("filters pools by Token-gated / multisig status (threshold > 1)", () => {
    render(<PoolsPage />);
    const gatedBtn = screen.getByRole("button", { name: /^token-gated$/i });
    fireEvent.click(gatedBtn);

    expect(screen.getByText(/2 pools found/i)).toBeInTheDocument();
    expect(screen.getByText(/pool-beta/i)).toBeInTheDocument();
    expect(screen.getByText(/pool-gamma/i)).toBeInTheDocument();
    expect(screen.queryByText(/pool-alpha/i)).not.toBeInTheDocument();
  });

  it("filters pools by 'My pools' matching connected user address", () => {
    render(<PoolsPage />);
    const myPoolsBtn = screen.getByRole("button", { name: /^my pools$/i });
    fireEvent.click(myPoolsBtn);

    expect(screen.getByText(/2 pools found/i)).toBeInTheDocument();
    expect(screen.getByText(/pool-alpha/i)).toBeInTheDocument();
    expect(screen.getByText(/pool-beta/i)).toBeInTheDocument();
    expect(screen.queryByText(/pool-gamma/i)).not.toBeInTheDocument();
  });

  it("supports text search query", () => {
    render(<PoolsPage />);
    const searchInput = screen.getByRole("searchbox", { name: /search pools/i });
    fireEvent.change(searchInput, { target: { value: "gamma" } });

    expect(screen.getByText(/1 pool found/i)).toBeInTheDocument();
    expect(screen.getByText(/pool-gamma/i)).toBeInTheDocument();
  });

  it("sorts pools by most members", () => {
    render(<PoolsPage />);
    const sortSelect = screen.getByRole("combobox", { name: /sort pools/i });
    fireEvent.change(sortSelect, { target: { value: "members" } });

    // pool-beta has 3 admins, pool-gamma has 2, pool-alpha has 1
    const links = screen.getAllByRole("link", { name: /view pool/i });
    expect(links[0]).toHaveAttribute("href", "/pools/pool-beta");
    expect(links[1]).toHaveAttribute("href", "/pools/pool-gamma");
    expect(links[2]).toHaveAttribute("href", "/pools/pool-alpha");
  });

  it("shows filtered empty state and clears filters", () => {
    render(<PoolsPage />);
    const searchInput = screen.getByRole("searchbox", { name: /search pools/i });
    fireEvent.change(searchInput, { target: { value: "nonexistent-query-string" } });

    expect(screen.getByText(/no pools match the selected filters/i)).toBeInTheDocument();
    const clearBtn = screen.getByRole("button", { name: /clear filters/i });
    fireEvent.click(clearBtn);

    expect(screen.getByText(/3 pools found/i)).toBeInTheDocument();
  });

  it("renders initial empty state when no pools exist", () => {
    mockUseAllPools.mockReturnValue({
      pools: [],
      state: "success",
      error: null,
      isStale: false,
      refresh: jest.fn(),
    });

    render(<PoolsPage />);
    expect(screen.getByText(/no pools available/i)).toBeInTheDocument();
  });
});
