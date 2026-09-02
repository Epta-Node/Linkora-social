import React from "react";
import { Text } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { ToastProvider, useToast, DEFAULT_DURATION_MS, LONG_DURATION_MS } from "../ToastContext";

function renderWithToast(toast: Parameters<ReturnType<typeof useToast>["showToast"]>[0]) {
  const triggerText = "trigger";
  const Harness = () => {
    const { showToast } = useToast();
    return <Text onPress={() => showToast(toast)}>{triggerText}</Text>;
  };
  render(
    <ToastProvider>
      <Harness />
    </ToastProvider>
  );
  fireEvent.press(screen.getByText(triggerText));
}

describe("ToastProvider auto-dismiss behaviour", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("auto-dismisses an informational toast after the default duration", async () => {
    renderWithToast({
      kind: "success",
      title: "Transaction confirmed",
      txHash: "abc",
      durationMs: DEFAULT_DURATION_MS,
    });

    expect(screen.getByText("Transaction confirmed")).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(DEFAULT_DURATION_MS - 1);
    });
    expect(screen.getByText("Transaction confirmed")).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Transaction confirmed")).toBeNull();
  });

  it("keeps an error toast visible beyond the default duration", () => {
    renderWithToast({
      kind: "error",
      title: "Transaction failed",
      message: "Insufficient balance",
    });

    expect(screen.getByText("Transaction failed")).toBeTruthy();

    // An informational toast would have been dismissed by now.
    act(() => {
      jest.advanceTimersByTime(DEFAULT_DURATION_MS);
    });
    expect(screen.getByText("Transaction failed")).toBeTruthy();

    // Errors default to LONG_DURATION_MS.
    act(() => {
      jest.advanceTimersByTime(LONG_DURATION_MS - DEFAULT_DURATION_MS);
    });
    expect(screen.queryByText("Transaction failed")).toBeNull();
  });

  it("honours an explicit per-toast duration override", () => {
    renderWithToast({
      kind: "error",
      title: "Custom duration",
      durationMs: 1500,
    });

    act(() => {
      jest.advanceTimersByTime(1499);
    });
    expect(screen.getByText("Custom duration")).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Custom duration")).toBeNull();
  });

  it("does not auto-dismiss a persistent toast", () => {
    renderWithToast({
      kind: "error",
      title: "Persistent message",
      persistent: true,
    });

    act(() => {
      jest.advanceTimersByTime(LONG_DURATION_MS * 5);
    });
    expect(screen.getByText("Persistent message")).toBeTruthy();
  });

  it("pauses the auto-dismiss timer while the toast is being touched", async () => {
    renderWithToast({ kind: "error", title: "Paused message", durationMs: 1000 });
    const toast = screen.getByTestId("toast");

    // User begins touching/reading before the duration elapses.
    act(() => {
      fireEvent(toast, "touchStart");
    });

    // Hold the touch well past the full duration — it must not auto-dismiss.
    jest.advanceTimersByTime(5000);
    expect(screen.queryByText("Paused message")).not.toBeNull();

    // After release the timer restarts and eventually dismisses.
    await act(async () => {
      fireEvent(toast, "touchEnd");
      jest.advanceTimersByTime(1000);
    });
    expect(screen.queryByText("Paused message")).toBeNull();
  });
});
