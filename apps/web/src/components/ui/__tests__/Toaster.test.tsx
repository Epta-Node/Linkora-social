import { act, render, screen } from "@testing-library/react";
import { toast, resetToasts } from "@/lib/toast";
import { Toaster } from "../Toaster";

describe("transaction toasts", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetToasts();
  });

  afterEach(() => {
    resetToasts();
    jest.useRealTimers();
  });

  it("links to Stellar Expert and dismisses a transaction success toast after five seconds", () => {
    render(<Toaster />);
    toast.success({ title: "Follow confirmed", txHash: "sample-hash", duration: 5000 });

    expect(screen.getByRole("link", { name: /View transaction: sample-hash/ })).toHaveAttribute(
      "href",
      "https://stellar.expert/explorer/testnet/tx/sample-hash"
    );

    act(() => {
      jest.advanceTimersByTime(4999);
    });
    expect(screen.getByText("Follow confirmed")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Follow confirmed")).not.toBeInTheDocument();
  });
});
