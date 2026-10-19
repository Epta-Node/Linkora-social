import { render, screen, fireEvent, within } from "@testing-library/react";
import { TipModal, toTipTokens } from "../TipModal";
import { useTokenBalances } from "@/hooks/useTokenBalances";
import { useTip } from "@/hooks/useTip";
import { useWalletContext } from "@/components/WalletProvider";

jest.mock("@/hooks/useTokenBalances", () => ({ useTokenBalances: jest.fn() }));
jest.mock("@/hooks/useTip", () => ({ useTip: jest.fn() }));
jest.mock("@/components/WalletProvider", () => ({ useWalletContext: jest.fn() }));
jest.mock("linkora-sdk", () => ({
  stellarAssetContractId: (b: { asset_type: string; asset_code?: string }) =>
    b.asset_type === "native"
      ? "CNATIVESAC"
      : b.asset_type === "liquidity_pool_shares"
        ? null
        : `CSAC_${b.asset_code}`,
}));
jest.mock("@/config", () => ({
  config: { contractId: "CLINKORA", networkPassphrase: "Test SDF Network ; September 2015" },
}));

const WALLET = "GTIPPER0000000000000000000000000000000000000000000000000";
const ISSUER = "GISSUERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const balances = [
  {
    asset_type: "native",
    asset_code: "XLM",
    asset_issuer: "",
    balance: "25.0000000",
    usdPrice: null,
    usdValue: null,
  },
  {
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: ISSUER,
    balance: "3.5000000",
    usdPrice: null,
    usdValue: null,
  },
  { asset_type: "liquidity_pool_shares", balance: "1.0000000", usdPrice: null, usdValue: null },
];

const tip = jest.fn();
const refresh = jest.fn();

function setup(
  overrides: { balances?: unknown; tip?: Record<string, unknown>; address?: string | null } = {}
) {
  (useWalletContext as jest.Mock).mockReturnValue({
    address: overrides.address === undefined ? WALLET : overrides.address,
    connected: overrides.address !== null,
  });
  (useTokenBalances as jest.Mock).mockReturnValue({
    tokens: balances,
    isLoading: false,
    error: null,
    refresh,
    ...(overrides.balances as object),
  });
  (useTip as jest.Mock).mockReturnValue({
    status: "idle",
    result: null,
    error: null,
    tip,
    reset: jest.fn(),
    ...overrides.tip,
  });
  return render(<TipModal postId={7} authorName="alice" onClose={jest.fn()} />);
}

const amountInput = () => screen.getByLabelText("Amount");
const submit = () => screen.getByRole("button", { name: "Confirm Tip" });

afterEach(() => jest.clearAllMocks());

describe("TipModal token selector (#1633)", () => {
  it("lists the wallet's tippable tokens with balances, loaded via useTokenBalances", () => {
    setup();

    expect(useTokenBalances).toHaveBeenCalledWith(WALLET);
    const group = screen.getByRole("radiogroup", { name: "Token" });
    const options = within(group).getAllByRole("radio");
    expect(options).toHaveLength(2); // pool shares have no SAC and are skipped
    expect(within(group).getByText("25 available")).toBeInTheDocument();
    expect(within(group).getByText("3.5 available")).toBeInTheDocument();
    expect(options[0]).toBeChecked();
  });

  it("keeps submit disabled until the amount is valid", () => {
    setup();
    expect(submit()).toBeDisabled();

    fireEvent.change(amountInput(), { target: { value: "2.5" } });
    expect(submit()).toBeEnabled();
  });

  it("shows an inline insufficient-balance error for the selected token", () => {
    setup();
    fireEvent.click(screen.getByRole("radio", { name: /USDC/ }));
    fireEvent.change(amountInput(), { target: { value: "4" } });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Insufficient balance — you have 3.5 USDC."
    );
    expect(amountInput()).toHaveAttribute("aria-invalid", "true");
    expect(submit()).toBeDisabled();
  });

  it("validates decimals against the token", () => {
    setup();
    fireEvent.change(amountInput(), { target: { value: "1.00000001" } });
    expect(screen.getByRole("alert")).toHaveTextContent("XLM supports at most 7 decimal places.");
  });

  it("tips with the wallet address, the token's contract address and its decimals", async () => {
    setup();
    fireEvent.click(screen.getByRole("radio", { name: /USDC/ }));
    fireEvent.change(amountInput(), { target: { value: "1.25" } });
    fireEvent.click(submit());

    expect(tip).toHaveBeenCalledWith(WALLET, BigInt(7), "CSAC_USDC", "1.25", 7, "CLINKORA");
  });

  it("fills the max balance on request", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Max: 25 XLM/ }));
    expect(amountInput()).toHaveValue("25");
    expect(submit()).toBeEnabled();
  });

  it("surfaces the readable cooldown error from useTip", () => {
    setup({ tip: { status: "error", error: "You tipped this post with this token recently." } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "tipped this post with this token recently"
    );
  });

  it("handles loading, failed and empty balances", () => {
    const { unmount } = setup({ balances: { tokens: [], isLoading: true } });
    expect(screen.getByText("Loading your balances…")).toBeInTheDocument();
    unmount();

    const failed = setup({ balances: { tokens: [], error: "Horizon returned 503" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Horizon returned 503");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalled();
    failed.unmount();

    setup({ balances: { tokens: [] } });
    expect(screen.getByText(/No tippable tokens/)).toBeInTheDocument();
    expect(submit()).toBeDisabled();
  });

  it("asks for a wallet when disconnected", () => {
    setup({ address: null });
    expect(screen.getByText("Connect your wallet to send a tip.")).toBeInTheDocument();
  });
});

describe("toTipTokens", () => {
  it("maps balances to contract addresses and skips assets without a SAC", () => {
    expect(toTipTokens(balances as never, "Test SDF Network ; September 2015")).toEqual([
      {
        key: "XLM",
        symbol: "XLM",
        issuer: null,
        contractId: "CNATIVESAC",
        balance: "25.0000000",
        decimals: 7,
      },
      {
        key: `USDC:${ISSUER}`,
        symbol: "USDC",
        issuer: ISSUER,
        contractId: "CSAC_USDC",
        balance: "3.5000000",
        decimals: 7,
      },
    ]);
  });
});
