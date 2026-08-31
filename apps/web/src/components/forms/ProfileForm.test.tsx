import { act, fireEvent, render, screen } from "@testing-library/react";
import { ProfileForm } from "./ProfileForm";

describe("ProfileForm", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("shows debounced validation feedback for a valid username", () => {
    render(<ProfileForm onSubmit={jest.fn()} />);

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "alice_123" },
    });

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(screen.getByText("Username is valid.")).toBeInTheDocument();
  });

  it("shows debounced validation feedback for invalid username characters", () => {
    render(<ProfileForm onSubmit={jest.fn()} />);

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "alice!" },
    });

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(
      screen.getByText("Username may only contain letters, numbers, and underscores.")
    ).toBeInTheDocument();
  });
});
