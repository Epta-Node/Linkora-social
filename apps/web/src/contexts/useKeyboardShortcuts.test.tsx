import React, { useRef } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { KeyboardShortcutsProvider, useKeyboardShortcutsContext } from "./KeyboardShortcutsContext";

// Mock next/navigation
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock useWallet
const mockUseWallet = jest.fn();
jest.mock("@/hooks/useWallet", () => ({
  useWallet: () => mockUseWallet(),
}));

// Test helper component
function KeyboardShortcutTestComponent() {
  const { registerComposeHandler, registerSearchRef, isHelpModalOpen } =
    useKeyboardShortcutsContext();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [composeOpened, setComposeOpened] = React.useState(false);

  React.useEffect(() => {
    registerComposeHandler(() => setComposeOpened(true));
    registerSearchRef(searchInputRef);
  }, [registerComposeHandler, registerSearchRef]);

  return (
    <div>
      <input data-testid="search-input" ref={searchInputRef} type="text" />
      <textarea data-testid="textarea-input" />
      <div data-testid="contenteditable-input" contentEditable="true" />
      <div data-testid="rich-text-input" role="textbox" />
      <div data-testid="compose-status">{composeOpened ? "Compose Open" : "Compose Closed"}</div>
      <div data-testid="modal-status">{isHelpModalOpen ? "Modal Open" : "Modal Closed"}</div>
    </div>
  );
}

describe("KeyboardShortcuts System", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockUseWallet.mockReturnValue({ address: "test-addr", connected: true });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const renderComponent = () => {
    return render(
      <KeyboardShortcutsProvider>
        <KeyboardShortcutTestComponent />
      </KeyboardShortcutsProvider>
    );
  };

  it("should open new post composer when 'n' is pressed", () => {
    renderComponent();
    expect(screen.getByTestId("compose-status")).toHaveTextContent("Compose Closed");

    fireEvent.keyDown(window, { key: "n" });

    expect(screen.getByTestId("compose-status")).toHaveTextContent("Compose Open");
  });

  it("should focus search bar when '/' is pressed", () => {
    renderComponent();
    const input = screen.getByTestId("search-input");
    expect(document.activeElement).not.toBe(input);

    fireEvent.keyDown(window, { key: "/" });

    expect(document.activeElement).toBe(input);
  });

  it("should toggle help modal when '?' is pressed", () => {
    renderComponent();
    expect(screen.getByTestId("modal-status")).toHaveTextContent("Modal Closed");

    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByTestId("modal-status")).toHaveTextContent("Modal Open");

    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByTestId("modal-status")).toHaveTextContent("Modal Closed");
  });

  it("should close modal when Escape is pressed", () => {
    renderComponent();
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByTestId("modal-status")).toHaveTextContent("Modal Open");

    // Escape using fireEvent on window
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByTestId("modal-status")).toHaveTextContent("Modal Closed");
  });

  it("should navigate to feed on 'g' then 'f'", () => {
    renderComponent();
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "f" });

    expect(mockPush).toHaveBeenCalledWith("/feed");
  });

  it("should navigate to profile on 'g' then 'p'", () => {
    renderComponent();
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "p" });

    expect(mockPush).toHaveBeenCalledWith("/profile/test-addr");
  });

  it("should navigate to static profile if wallet is not connected", () => {
    mockUseWallet.mockReturnValue({ address: null, connected: false });
    renderComponent();
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "p" });

    expect(mockPush).toHaveBeenCalledWith("/profile");
  });

  it("should navigate to settings on 'g' then 's'", () => {
    renderComponent();
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "s" });

    expect(mockPush).toHaveBeenCalledWith("/settings");
  });

  it("should reset sequence after timeout", () => {
    renderComponent();
    fireEvent.keyDown(window, { key: "g" });

    // Advance timers past 500ms
    act(() => {
      jest.advanceTimersByTime(501);
    });

    fireEvent.keyDown(window, { key: "f" });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("should reset sequence if an unrecognized key is pressed after 'g'", () => {
    renderComponent();
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "x" }); // unrecognized
    fireEvent.keyDown(window, { key: "f" });

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("should ignore shortcuts when typing in inputs/textareas/contenteditable/rich-text", () => {
    renderComponent();
    const input = screen.getByTestId("search-input");
    const textarea = screen.getByTestId("textarea-input");
    const contenteditable = screen.getByTestId("contenteditable-input");
    const richText = screen.getByTestId("rich-text-input");

    // Input focus
    input.focus();
    fireEvent.keyDown(input, { key: "n" });
    expect(screen.getByTestId("compose-status")).toHaveTextContent("Compose Closed");

    // Textarea focus
    textarea.focus();
    fireEvent.keyDown(textarea, { key: "n" });
    expect(screen.getByTestId("compose-status")).toHaveTextContent("Compose Closed");

    // Contenteditable focus
    contenteditable.focus();
    fireEvent.keyDown(contenteditable, { key: "n" });
    expect(screen.getByTestId("compose-status")).toHaveTextContent("Compose Closed");

    // Rich text focus
    richText.focus();
    fireEvent.keyDown(richText, { key: "n" });
    expect(screen.getByTestId("compose-status")).toHaveTextContent("Compose Closed");
  });

  it("should ignore shortcuts when modifier key is pressed", () => {
    renderComponent();
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(screen.getByTestId("compose-status")).toHaveTextContent("Compose Closed");

    fireEvent.keyDown(window, { key: "n", altKey: true });
    expect(screen.getByTestId("compose-status")).toHaveTextContent("Compose Closed");

    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(screen.getByTestId("compose-status")).toHaveTextContent("Compose Closed");
  });
});
