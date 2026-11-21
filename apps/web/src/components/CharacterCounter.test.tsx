import { fireEvent, render, screen } from "@testing-library/react";
import { CharacterCounter, getCharacterCounterStatus } from "./CharacterCounter";
import { RichTextComposer } from "./RichTextComposer";

describe("CharacterCounter", () => {
  it("shows green when under 80% of the limit", () => {
    expect(getCharacterCounterStatus(100, 280)).toBe("ok");
    render(<CharacterCounter contentLength={100} maxLength={280} />);
    const counter = screen.getByLabelText("180 characters remaining");
    expect(counter).toHaveAttribute("data-status", "ok");
    expect(counter).toHaveStyle({ color: "#22c55e" });
  });

  it("shows yellow when between 80% and 100% of the limit", () => {
    expect(getCharacterCounterStatus(224, 280)).toBe("warning");
    expect(getCharacterCounterStatus(279, 280)).toBe("warning");
    render(<CharacterCounter contentLength={240} maxLength={280} />);
    const counter = screen.getByLabelText("40 characters remaining");
    expect(counter).toHaveAttribute("data-status", "warning");
    expect(counter).toHaveStyle({ color: "#eab308" });
  });

  it("shows red when at or over the limit", () => {
    expect(getCharacterCounterStatus(280, 280)).toBe("limit");
    expect(getCharacterCounterStatus(300, 280)).toBe("limit");
    render(<CharacterCounter contentLength={285} maxLength={280} />);
    const counter = screen.getByLabelText("-5 characters remaining");
    expect(counter).toHaveAttribute("data-status", "limit");
    expect(counter).toHaveStyle({ color: "#ef4444" });
  });
});

describe("RichTextComposer character limit", () => {
  it("updates counter status and disables Post button when over limit", () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const { container } = render(<RichTextComposer onSubmit={onSubmit} />);
    const editor = container.querySelector(".composer-editor") as HTMLElement;
    const submitBtn = screen.getByRole("button", { name: "Post" });

    // Under 80%: ok, enabled
    editor.innerText = "Hello Stellar";
    fireEvent.input(editor);
    expect(container.querySelector(".char-counter")).toHaveAttribute("data-status", "ok");
    expect(submitBtn).not.toBeDisabled();

    // Between 80% and 100%: warning, enabled
    editor.innerText = "a".repeat(230);
    fireEvent.input(editor);
    expect(container.querySelector(".char-counter")).toHaveAttribute("data-status", "warning");
    expect(submitBtn).not.toBeDisabled();

    // Over 100%: limit, submit disabled
    editor.innerText = "a".repeat(285);
    fireEvent.input(editor);
    expect(container.querySelector(".char-counter")).toHaveAttribute("data-status", "limit");
    expect(submitBtn).toBeDisabled();
  });
});
