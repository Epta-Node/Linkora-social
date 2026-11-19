/**
 * #1852 — pool detail loading state.
 *
 * The page must paint the granular skeleton (balance, admins, threshold,
 * deposit/withdraw tabs) before pool data arrives, then swap it for the real
 * content.
 */
import React from "react";
import { act, render, screen } from "@testing-library/react";
import PoolDetailPage from "@/app/pools/[id]/page";
import type { PoolData } from "@/hooks/usePools";

jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "community" }),
}));

jest.mock("next/link", () => {
  const Link = ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  );
  return { __esModule: true, default: Link };
});

jest.mock("@/components/WalletProvider", () => ({
  useWallet: () => ({ publicKey: null, isConnected: false }),
}));

jest.mock("@/components/PoolDepositForm", () => ({ PoolDepositForm: () => null }));
jest.mock("@/components/PoolWithdrawForm", () => ({ PoolWithdrawForm: () => null }));

const ADMIN = "G" + "A".repeat(55);
const POOL: PoolData = {
  pool_id: "community",
  token: "C" + "B".repeat(55),
  balance: BigInt(12_5000000),
  admins: [ADMIN],
  threshold: 1,
};

let resolvePool: (pool: PoolData) => void = () => undefined;

// Mirrors the real hook's lifecycle: "idle" on the first render, "loading"
// once the effect starts the fetch, "success" when the contract answers.
jest.mock("@/hooks/usePools", () => {
  const actual = jest.requireActual("@/hooks/usePools");
  const { useEffect, useState } = jest.requireActual("react");
  return {
    ...actual,
    useTokenMeta: () => ({ symbol: "XLM", decimals: 7, name: "Stellar Lumens" }),
    usePool: (poolId: string | null) => {
      const [pool, setPool] = useState(null);
      const [state, setState] = useState("idle");
      useEffect(() => {
        if (!poolId) return;
        setState("loading");
        new Promise<PoolData>((resolve) => {
          resolvePool = resolve;
        }).then((data) => {
          setPool(data);
          setState("success");
        });
      }, [poolId]);
      return { pool, state, error: null, refresh: jest.fn() };
    },
  };
});

describe("Pool detail page loading state (#1852)", () => {
  it("renders the skeleton before pool data arrives", () => {
    render(<PoolDetailPage />);

    const skeleton = screen.getByTestId("pool-detail-skeleton");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("pool-skeleton-balance")).toBeInTheDocument();
    expect(screen.getByTestId("pool-skeleton-admins")).toBeInTheDocument();
    expect(screen.getByTestId("pool-skeleton-threshold")).toBeInTheDocument();
    expect(screen.getByTestId("pool-skeleton-tabs")).toBeInTheDocument();

    // No real data yet.
    expect(screen.queryByRole("heading", { name: "community" })).not.toBeInTheDocument();
    expect(screen.queryByText("Pool Stats")).not.toBeInTheDocument();
  });

  it("replaces the skeleton with the pool once data arrives", async () => {
    render(<PoolDetailPage />);
    expect(screen.getByTestId("pool-detail-skeleton")).toBeInTheDocument();

    await act(async () => {
      resolvePool(POOL);
    });

    expect(screen.queryByTestId("pool-detail-skeleton")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "community" })).toBeInTheDocument();
    expect(screen.getByText("Pool Stats")).toBeInTheDocument();
    expect(screen.getByText("12.5 XLM")).toBeInTheDocument();
  });
});
