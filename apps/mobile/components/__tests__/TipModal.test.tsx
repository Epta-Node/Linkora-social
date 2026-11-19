/**
 * #1790 / #1789 — the tip sheet runs on the shared BottomSheet and exposes
 * every control to assistive tech.
 */
import React from "react";
import { Modal } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { TipModal } from "../TipModal";
import { findInaccessibleTouchables } from "../../utils/a11y";

const mockReset = jest.fn();
const mockTip = jest.fn();
let mockPending = false;

jest.mock("../../hooks/useTip", () => ({
  useTip: () => ({
    pending: mockPending,
    status: "idle",
    error: null,
    result: null,
    estimateProtocolFee: (amount: number) => amount * 0.01,
    tip: mockTip,
    reset: mockReset,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockPending = false;
});

describe("TipModal", () => {
  it("renders inside a bottom sheet when visible", () => {
    render(<TipModal visible postId={7} authorName="alice" onClose={jest.fn()} />);

    expect(screen.getByTestId("tip-sheet")).toBeTruthy();
    expect(screen.getByRole("header", { name: "Send Tip" })).toBeTruthy();
    expect(screen.getByText("Tipping @alice on post #7")).toBeTruthy();
  });

  it("renders nothing while hidden", () => {
    render(<TipModal visible={false} postId={7} authorName="alice" onClose={jest.fn()} />);
    expect(screen.queryByTestId("tip-sheet")).toBeNull();
  });

  it("closes from the close button and from hardware back", () => {
    const onClose = jest.fn();
    render(<TipModal visible postId={7} authorName="alice" onClose={onClose} />);

    fireEvent.press(screen.getByRole("button", { name: "Close tip sheet" }));
    act(() => {
      screen.UNSAFE_getByType(Modal).props.onRequestClose();
    });

    expect(onClose).toHaveBeenCalledTimes(2);
    expect(mockReset).toHaveBeenCalledTimes(2);
  });

  it("cannot be dismissed while a tip is pending", () => {
    mockPending = true;
    const onClose = jest.fn();
    render(<TipModal visible postId={7} authorName="alice" onClose={onClose} />);

    act(() => {
      screen.UNSAFE_getByType(Modal).props.onRequestClose();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("selects a token through an accessible radio group", () => {
    render(<TipModal visible postId={7} authorName="alice" onClose={jest.fn()} />);

    const usdc = screen.getByRole("radio", { name: "Tip with USD Coin (USDC)" });
    fireEvent.press(usdc);
    expect(
      screen.getByRole("radio", { name: "Tip with USD Coin (USDC)" }).props.accessibilityState
    ).toEqual(expect.objectContaining({ checked: true }));
  });

  it("submits the entered amount", () => {
    render(<TipModal visible postId={7} authorName="alice" onClose={jest.fn()} />);

    fireEvent.changeText(screen.getByLabelText("Tip amount"), "5");
    fireEvent.press(screen.getByRole("button", { name: "Confirm tip" }));

    expect(mockTip).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: 7,
        amount: 5,
        token: expect.objectContaining({ symbol: "XLM" }),
      })
    );
  });

  it("has no unlabelled interactive elements", () => {
    render(<TipModal visible postId={7} authorName="alice" onClose={jest.fn()} />);
    expect(findInaccessibleTouchables(screen.UNSAFE_root)).toEqual([]);
  });
});
