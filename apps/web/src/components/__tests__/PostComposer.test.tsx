import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PostComposer } from "../post/PostComposer";
import { CharacterCounter } from "../post/CharacterCounter";

/* ------------------------------------------------------------------ */
/*  CharacterCounter unit tests                                        */
/* ------------------------------------------------------------------ */

describe("CharacterCounter", () => {
  it("counts UTF-8 bytes, not JS code units", () => {
    render(<CharacterCounter value="hello" />);
    expect(screen.getByTestId("character-counter").textContent).toContain("5 / 280");
  });

  it("counts multi-byte emoji as multiple UTF-8 bytes", () => {
    // 😀 is 4 bytes in UTF-8.
    render(<CharacterCounter value="😀" />);
    expect(screen.getByTestId("character-counter").textContent).toContain("4 / 280");
  });

  it("counts accented Latin characters as their UTF-8 byte length", () => {
    // "café" -> é is 2 bytes, so total 5 bytes.
    render(<CharacterCounter value="café" />);
    expect(screen.getByTestId("character-counter").textContent).toContain("5 / 280");
  });

  it("counts CJK characters as 3 bytes each", () => {
    // Each of 中文 is 3 bytes in UTF-8.
    render(<CharacterCounter value="中文" />);
    expect(screen.getByTestId("character-counter").textContent).toContain("6 / 280");
  });

  it("turns red when the UTF-8 byte count exceeds the max", () => {
    render(<CharacterCounter value={"a".repeat(281)} max={280} />);
    const el = screen.getByTestId("character-counter");
    expect(el.textContent).toContain("281 / 280");
    expect(el.className).toContain("text-red-600");
  });

  it("applies near-limit styling at 90% of max", () => {
    const nearLimit = "a".repeat(252); // 252 bytes = 90% of 280
    render(<CharacterCounter value={nearLimit} max={280} />);
    const el = screen.getByTestId("character-counter");
    expect(el.textContent).toContain("252 / 280");
    expect(el.className).toContain("text-red-500");
  });
});

/* ------------------------------------------------------------------ */
/*  PostComposer unit tests                                            */
/* ------------------------------------------------------------------ */

const baseProps = {
  images: [] as any[],
  onAddImages: jest.fn(),
  onRemoveImage: jest.fn(),
  linkUrl: "",
  onChangeLinkUrl: jest.fn(),
  linkPreview: null,
  isLinkLoading: false,
};

function renderComposer(overrides: any = {}) {
  let onChangeContentMock: jest.Mock;
  const Wrapper: React.FC<{ children: (props: any) => React.ReactNode }> = ({ children }) => {
    const [content, setContent] = useState("");
    onChangeContentMock = jest.fn((v: string) => setContent(v));
    const props = { ...baseProps, content, onChangeContent: onChangeContentMock, ...overrides };
    return <>{children(props)}</>;
  };

  const view = render(<Wrapper>{(props) => <PostComposer {...props} />}</Wrapper>);
  const textarea = document.querySelector("textarea")!;
  return { ...view, onChangeContent: onChangeContentMock!, textarea };
}

describe("PostComposer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("always forwards user input to onChangeContent", () => {
    const { onChangeContent, textarea } = renderComposer();
    fireEvent.input(textarea, { target: { value: "hello" } });
    expect(onChangeContent).toHaveBeenCalledWith("hello");
  });

  it("forwards input even when the byte count exceeds the limit", () => {
    const { onChangeContent, textarea } = renderComposer({ characterLimit: 10 });
    fireEvent.input(textarea, { target: { value: "abcdefghijk" } });
    expect(onChangeContent).toHaveBeenCalledWith("abcdefghijk");
  });

  it("calls onLimitExceeded(false) when within the byte limit", () => {
    const onLimitExceeded = jest.fn();
    const { textarea } = renderComposer({ characterLimit: 280, onLimitExceeded });

    // Drive the component through its controlled prop so the effect sees the new value.
    fireEvent.input(textarea, { target: { value: "hello" } });

    expect(onLimitExceeded).toHaveBeenCalledWith(false);
  });

  it("calls onLimitExceeded(true) when byte count exceeds the limit", () => {
    const onLimitExceeded = jest.fn();
    const { textarea } = renderComposer({ characterLimit: 10, onLimitExceeded });

    fireEvent.input(textarea, { target: { value: "abcdefghijk" } });

    expect(onLimitExceeded).toHaveBeenCalledWith(true);
  });

  it("treats exactly-at-the-byte-limit as not exceeded", () => {
    const onLimitExceeded = jest.fn();
    const { textarea } = renderComposer({ characterLimit: 4, onLimitExceeded });

    // "😀" is 4 UTF-8 bytes.
    fireEvent.input(textarea, { target: { value: "😀" } });

    expect(onLimitExceeded).toHaveBeenCalledWith(false);
  });

  it("treats one byte over the limit as exceeded for multi-byte characters", () => {
    const onLimitExceeded = jest.fn();
    const { textarea } = renderComposer({ characterLimit: 4, onLimitExceeded });

    // "😀😀" is 8 UTF-8 bytes.
    fireEvent.input(textarea, { target: { value: "😀😀" } });

    expect(onLimitExceeded).toHaveBeenCalledWith(true);
  });

  it("updates the CharacterCounter with correct UTF-8 byte count for emoji", () => {
    const { textarea } = renderComposer({ characterLimit: 280 });

    fireEvent.input(textarea, { target: { value: "Hello 😀" } });

    // "Hello " = 6, "😀" = 4 => total 10 bytes.
    expect(screen.getByTestId("character-counter").textContent).toContain("10 / 280");
  });
});
