import React from "react";
import { render, screen } from "@testing-library/react-native";

import { OfflineBanner } from "../OfflineBanner";

describe("OfflineBanner", () => {
  it("shows a persistent accessible banner while offline and hides it when connection returns", () => {
    const { rerender } = render(<OfflineBanner isOffline />);

    expect(screen.getByText("No internet connection")).toBeTruthy();
    expect(screen.getByTestId("offline-banner").props.accessibilityRole).toBe("alert");

    rerender(<OfflineBanner isOffline={false} />);
    expect(screen.queryByTestId("offline-banner")).toBeNull();
  });
});
