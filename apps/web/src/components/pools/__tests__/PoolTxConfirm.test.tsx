import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { DepositTab } from "../DepositTab";
import { WithdrawTab } from "../WithdrawTab";
import { thresholdImplication } from "../PoolTxConfirmDialog";
import { useDeposit, useWithdraw } from "@/hooks/usePoolContract";

jest.mock("@/hooks/usePoolContract", () => ({
  useDeposit: jest.fn(),
  useWithdraw: jest.fn(),
}));

const ADMIN = "GADMIN1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ADMIN2 = "GADMIN2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TOKEN = "CTOKENAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const pool = {
  pool_id: "community-fund",
  token: TOKEN,
  balance: BigInt(1_000_000_000), // 100 USDC at 7 decimals
  admins: [ADMIN, ADMIN2, "GADMIN3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
  threshold: 2,
};
const tokenMeta = { symbol: "USDC", decimals: 7, name: "USD Coin" };

const deposit = jest.fn();
const withdraw = jest.fn();

beforeEach(() => {
  (useDeposit as jest.Mock).mockReturnValue({
    status: "idle",
    result: null,
    error: null,
    deposit,
    reset: jest.fn(),
  });
  (useWithdraw as jest.Mock).mockReturnValue({
    status: "idle",
    result: null,
    error: null,
    withdraw,
    reset: jest.fn(),
  });
});

afterEach(() => jest.clearAllMocks());

function renderDeposit() {
  render(
    <DepositTab
      pool={pool}
      tokenMeta={tokenMeta}
      currentUser={ADMIN}
      contractAddress="CLINKORA"
      onSuccess={jest.fn()}
    />
  );
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "12.5" } });
  fireEvent.click(screen.getByRole("button", { name: /^Deposit 12.5 USDC/ }));
}

describe("Pool deposit confirmation (#1634)", () => {
  it("shows the summary before any wallet prompt", () => {
    renderDeposit();

    const dialog = screen.getByRole("dialog", { name: "Confirm deposit" });
    const summary = within(dialog).getByTestId("pool-tx-summary");
    expect(summary).toHaveTextContent("Amount12.5 USDC");
    expect(summary).toHaveTextContent("USDC · 7 decimals");
    expect(summary).toHaveTextContent("community-fund");
    expect(summary).toHaveTextContent("Admin threshold2 of 3");
    expect(summary).toHaveTextContent("Pool balance after112.5 USDC");
    expect(within(dialog).getByRole("note")).toHaveTextContent("2 of 3 admin signatures");
    expect(deposit).not.toHaveBeenCalled();
  });

  it("cancel returns to the form with its state intact and signs nothing", async () => {
    renderDeposit();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Amount")).toHaveValue("12.5");
    expect(deposit).not.toHaveBeenCalled();
  });

  it("Escape also cancels without signing", async () => {
    renderDeposit();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Amount")).toHaveValue("12.5");
    expect(deposit).not.toHaveBeenCalled();
  });

  it("confirming closes the summary and starts the deposit", async () => {
    renderDeposit();
    fireEvent.click(screen.getByRole("button", { name: "Deposit & sign" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(deposit).toHaveBeenCalledWith(ADMIN, "community-fund", TOKEN, "12.5", 7, "CLINKORA");
  });

  it("does not open the summary for an invalid amount", () => {
    render(
      <DepositTab
        pool={pool}
        tokenMeta={tokenMeta}
        currentUser={ADMIN}
        contractAddress="C"
        onSuccess={jest.fn()}
      />
    );
    fireEvent.submit(screen.getByLabelText("Amount").closest("form")!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount");
  });
});

describe("Pool withdrawal confirmation (#1634)", () => {
  it("summarises recipient and threshold, then withdraws only on confirm", async () => {
    const singleSigPool = { ...pool, threshold: 1 };
    render(
      <WithdrawTab
        pool={singleSigPool}
        tokenMeta={tokenMeta}
        currentUser={ADMIN}
        onSuccess={jest.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Recipient address"), { target: { value: ADMIN2 } });
    fireEvent.click(screen.getByRole("button", { name: /^Withdraw 40 USDC/ }));

    const dialog = screen.getByRole("dialog", { name: "Confirm withdraw" });
    expect(within(dialog).getByTestId("pool-tx-summary")).toHaveTextContent(
      "Pool balance after60 USDC"
    );
    expect(within(dialog).getByTestId("pool-tx-summary")).toHaveTextContent("GADMIN…AAAA");
    expect(within(dialog).getByRole("note")).toHaveTextContent("executes as soon as you sign");
    expect(withdraw).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Recipient address")).toHaveValue(ADMIN2);
    expect(withdraw).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^Withdraw 40 USDC/ }));
    fireEvent.click(screen.getByRole("button", { name: "Withdraw & sign" }));
    await waitFor(() =>
      expect(withdraw).toHaveBeenCalledWith([ADMIN], "community-fund", "40", 7, ADMIN2)
    );
  });
});

describe("thresholdImplication", () => {
  const base = {
    amount: "1",
    symbol: "USDC",
    decimals: 7,
    token: TOKEN,
    poolId: "p",
    adminCount: 3,
  };

  it("explains the co-signers a multisig withdrawal still needs", () => {
    expect(thresholdImplication({ ...base, action: "withdraw", threshold: 3 })).toMatch(
      "requires 3 of 3 admin signatures. Your signature counts as one; 2 more admins must co-sign"
    );
  });

  it("warns that deposited funds are locked behind the threshold", () => {
    expect(thresholdImplication({ ...base, action: "deposit", threshold: 2 })).toMatch(
      "can only leave the pool with 2 of 3 admin signatures"
    );
  });
});
