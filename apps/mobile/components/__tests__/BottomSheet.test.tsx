/**
 * #1790 — gesture-driven BottomSheet and the sheets built on it.
 */
import React from "react";
import { Modal, Text } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import GorhomBottomSheet, { BottomSheetBackdrop } from "@gorhom/bottom-sheet";

import { BottomSheet, SHEET_SNAP_POINTS, SHEET_DEFAULT_INDEX } from "../BottomSheet";
import { WalletSignSheet } from "../../mini-apps/WalletSignSheet";
import { findInaccessibleTouchables } from "../../utils/a11y";

type GorhomProps = React.ComponentProps<typeof GorhomBottomSheet>;

function sheetProps(): GorhomProps {
  return screen.UNSAFE_getByType(GorhomBottomSheet).props as GorhomProps;
}

describe("BottomSheet", () => {
  it("renders nothing while hidden", () => {
    render(
      <BottomSheet visible={false} onClose={jest.fn()} accessibilityLabel="Hidden sheet">
        <Text>Body</Text>
      </BottomSheet>
    );

    expect(screen.queryByText("Body")).toBeNull();
  });

  it("renders its title and content when visible", () => {
    render(
      <BottomSheet visible onClose={jest.fn()} title="Deposit" accessibilityLabel="Deposit sheet">
        <Text>Body</Text>
      </BottomSheet>
    );

    expect(screen.getByText("Body")).toBeTruthy();
    expect(screen.getByRole("header", { name: "Deposit" })).toBeTruthy();
  });

  it("uses the 30% / 60% / 100% snap points and opens at 60%", () => {
    render(
      <BottomSheet visible onClose={jest.fn()} accessibilityLabel="Sheet">
        <Text>Body</Text>
      </BottomSheet>
    );

    const props = sheetProps();
    expect(SHEET_SNAP_POINTS).toEqual(["30%", "60%", "100%"]);
    expect(props.snapPoints).toEqual(["30%", "60%", "100%"]);
    expect(props.index).toBe(SHEET_DEFAULT_INDEX);
    expect(SHEET_DEFAULT_INDEX).toBe(1);
    expect(props.enableDynamicSizing).toBe(false);
  });

  it("supports swipe-to-dismiss and is keyboard aware", () => {
    render(
      <BottomSheet visible onClose={jest.fn()} accessibilityLabel="Sheet">
        <Text>Body</Text>
      </BottomSheet>
    );

    const props = sheetProps();
    expect(props.enablePanDownToClose).toBe(true);
    expect(props.keyboardBehavior).toBe("interactive");
    expect(props.keyboardBlurBehavior).toBe("restore");
    expect(props.android_keyboardInputMode).toBe("adjustResize");
  });

  it("calls onClose when the sheet is swiped closed", () => {
    const onClose = jest.fn();
    render(
      <BottomSheet visible onClose={onClose} accessibilityLabel="Sheet">
        <Text>Body</Text>
      </BottomSheet>
    );

    act(() => {
      sheetProps().onClose?.();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders a dimmed backdrop that closes the sheet on tap", () => {
    render(
      <BottomSheet visible onClose={jest.fn()} accessibilityLabel="Sheet">
        <Text>Body</Text>
      </BottomSheet>
    );

    const renderBackdrop = sheetProps().backdropComponent as (p: object) => React.ReactElement;
    const backdrop = renderBackdrop({}) as React.ReactElement<Record<string, unknown>>;
    expect(backdrop.type).toBe(BottomSheetBackdrop);
    expect(backdrop.props.pressBehavior).toBe("close");
    expect(backdrop.props.appearsOnIndex).toBe(0);
    expect(backdrop.props.disappearsOnIndex).toBe(-1);
    expect(backdrop.props.opacity).toBeGreaterThan(0);
  });

  it("closes on hardware back (Escape)", () => {
    const onClose = jest.fn();
    render(
      <BottomSheet visible onClose={onClose} accessibilityLabel="Sheet">
        <Text>Body</Text>
      </BottomSheet>
    );

    act(() => {
      screen.UNSAFE_getByType(Modal).props.onRequestClose();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open while not dismissible", () => {
    const onClose = jest.fn();
    render(
      <BottomSheet visible dismissible={false} onClose={onClose} accessibilityLabel="Sheet">
        <Text>Body</Text>
      </BottomSheet>
    );

    act(() => {
      screen.UNSAFE_getByType(Modal).props.onRequestClose();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(sheetProps().enablePanDownToClose).toBe(false);
  });

  it("traps screen-reader focus inside the open sheet", () => {
    render(
      <BottomSheet visible onClose={jest.fn()} accessibilityLabel="Sheet" testID="sheet">
        <Text>Body</Text>
      </BottomSheet>
    );

    expect(screen.getByTestId("sheet").props.accessibilityViewIsModal).toBe(true);
    expect(screen.UNSAFE_getByType(Modal).props.transparent).toBe(true);
  });
});

describe("WalletSignSheet", () => {
  const XDR = "AAAAAgAAAAB...";

  it("approves only through the Approve button", () => {
    const onApprove = jest.fn();
    const onReject = jest.fn();
    render(<WalletSignSheet xdr={XDR} onApprove={onApprove} onReject={onReject} />);

    expect(screen.getByText(XDR)).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Approve and sign transaction" }));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
  });

  it("treats dismissal as a rejection", () => {
    const onApprove = jest.fn();
    const onReject = jest.fn();
    render(<WalletSignSheet xdr={XDR} onApprove={onApprove} onReject={onReject} />);

    act(() => {
      screen.UNSAFE_getByType(Modal).props.onRequestClose();
    });
    fireEvent.press(screen.getByRole("button", { name: "Reject transaction" }));
    expect(onReject).toHaveBeenCalledTimes(2);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("has no unlabelled interactive elements", () => {
    render(<WalletSignSheet xdr={XDR} onApprove={jest.fn()} onReject={jest.fn()} />);
    expect(findInaccessibleTouchables(screen.UNSAFE_root)).toEqual([]);
  });
});
