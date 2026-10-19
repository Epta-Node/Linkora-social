import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { NavBar } from "@/components/NavBar";
import {
  KeyboardShortcutsProvider,
  useKeyboardShortcutsContext,
} from "@/contexts/KeyboardShortcutsContext";
import { KeyboardShortcutsModal } from "@/components/KeyboardShortcutsModal";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({
    address: "GABCDE3WZ",
    connected: true,
    network: "testnet",
    connect: jest.fn(),
    disconnect: jest.fn(),
    isConnecting: false,
  }),
}));

jest.mock("@/contexts/NotificationsContext", () => ({
  useNotificationsContext: () => ({ unreadCount: 0 }),
}));

jest.mock("@/components/SearchBar", () => ({
  __esModule: true,
  default: ({ inputRef }: { inputRef?: React.Ref<HTMLInputElement> }) => (
    <input ref={inputRef} data-testid="search-bar" />
  ),
}));

jest.mock("@/components/mobile/BottomNav", () => ({
  BottomNav: () => null,
}));

jest.mock("@/components/modals/CreatePostModal", () => ({
  CreatePostModal: () => null,
}));

jest.mock("@/components/modals/WalletModal", () => ({
  WalletModal: () => null,
}));

jest.mock("@/components/branding/Logo", () => ({
  Logo: () => <span>Logo</span>,
}));

jest.mock("@/components/ThemeBootstrap", () => ({
  getStoredThemePreference: () => "light",
  storeThemePreference: jest.fn(),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <KeyboardShortcutsProvider>
      {children}
      <KeyboardShortcutsModal />
    </KeyboardShortcutsProvider>
  );
}

describe("NavBar — keyboard shortcuts entry point (#1636)", () => {
  it("renders the keyboard shortcuts button on desktop", () => {
    render(
      <Wrapper>
        <NavBar />
      </Wrapper>
    );
    expect(
      screen.getByTestId("keyboard-shortcuts-entry")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Keyboard shortcuts" })
    ).toBeInTheDocument();
  });

  it("opens the keyboard shortcuts modal when the button is clicked", () => {
    render(
      <Wrapper>
        <NavBar />
      </Wrapper>
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("keyboard-shortcuts-entry"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
  });

  it("modal lists known shortcuts after entry point opens it", () => {
    render(
      <Wrapper>
        <NavBar />
      </Wrapper>
    );

    fireEvent.click(screen.getByTestId("keyboard-shortcuts-entry"));

    expect(screen.getByText("Open new post composer")).toBeInTheDocument();
    expect(screen.getByText("Focus the global search bar")).toBeInTheDocument();
    expect(screen.getByText("Open keyboard shortcuts help")).toBeInTheDocument();
  });
});
