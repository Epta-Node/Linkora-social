import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import {
  KeyboardShortcutsProvider,
  useKeyboardShortcutsContext,
} from "@/contexts/KeyboardShortcutsContext";

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

// Mock useWallet
jest.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({
    address: "test-addr",
    connected: true,
  }),
}));

// Helper to open the modal using the context trigger
function ModalController() {
  const { openHelpModal } = useKeyboardShortcutsContext();
  return <button onClick={openHelpModal}>Open Modal</button>;
}

describe("KeyboardShortcutsModal", () => {
  const renderModal = (isOpen = false) => {
    return render(
      <KeyboardShortcutsProvider>
        {isOpen && <ModalController />}
        <KeyboardShortcutsModal />
      </KeyboardShortcutsProvider>
    );
  };

  it("should not render when closed", () => {
    renderModal(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("should render list of shortcuts when open", () => {
    renderModal(true);
    // Click button to open modal
    fireEvent.click(screen.getByRole("button", { name: "Open Modal" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
    expect(screen.getByText("Open new post composer")).toBeInTheDocument();
    expect(screen.getByText("Focus the global search bar")).toBeInTheDocument();
    expect(screen.getByText("Go to Feed")).toBeInTheDocument();
    expect(screen.getByText("Go to Settings")).toBeInTheDocument();
  });

  it("should close when Escape key is pressed in the modal", () => {
    renderModal(true);
    fireEvent.click(screen.getByRole("button", { name: "Open Modal" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const panel = screen.getByTestId("kbd-modal-panel");
    fireEvent.keyDown(panel, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("should close when backdrop is clicked", () => {
    renderModal(true);
    fireEvent.click(screen.getByRole("button", { name: "Open Modal" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const backdrop = screen.getByTestId("kbd-modal-backdrop");
    fireEvent.click(backdrop);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("should not close when the modal panel is clicked", () => {
    renderModal(true);
    fireEvent.click(screen.getByRole("button", { name: "Open Modal" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const panel = screen.getByTestId("kbd-modal-panel");
    fireEvent.click(panel);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("should meet accessibility guidelines", async () => {
    const { container } = renderModal(true);
    fireEvent.click(screen.getByRole("button", { name: "Open Modal" }));

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
