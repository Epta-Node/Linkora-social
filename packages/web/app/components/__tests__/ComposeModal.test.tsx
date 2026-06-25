import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { ComposeModal } from "../ComposeModal";
import * as WalletProviderModule from "../WalletProvider";
import * as NotificationContextModule from "../../context/NotificationContext";

expect.extend(toHaveNoViolations);

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

jest.mock("linkora-sdk", () => ({
  LinkoraClient: jest.fn().mockImplementation(() => ({
    createPost: jest.fn(),
  })),
}));

jest.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      submitTransaction: jest.fn(),
    })),
  },
  TransactionBuilder: {
    fromXDR: jest.fn(),
  },
}));

jest.mock("@stellar/freighter-api", () => ({
  signTransaction: jest.fn(),
}));

describe("ComposeModal & CharacterCounter & accessibility", () => {
  const mockWalletValue = {
    publicKey: "GBRPYHIL2CI3WHZDTOOQFC6EB4RBIGSJRVSBUOYS77TQ7CQK5FHQ6SR",
    isConnected: true,
    isConnecting: false,
    error: null,
    connect: jest.fn(),
    disconnect: jest.fn(),
  };

  const mockNotificationValue = {
    notifications: [],
    addNotification: jest.fn().mockReturnValue("notif-123"),
    removeNotification: jest.fn(),
    updateNotification: jest.fn(),
  };

  let useWalletSpy: jest.SpyInstance;
  let useNotificationSpy: jest.SpyInstance;

  beforeEach(() => {
    useWalletSpy = jest
      .spyOn(WalletProviderModule, "useWallet")
      .mockImplementation(() => mockWalletValue);
    useNotificationSpy = jest
      .spyOn(NotificationContextModule, "useNotification")
      .mockImplementation(() => mockNotificationValue);
  });

  afterEach(() => {
    useWalletSpy.mockRestore();
    useNotificationSpy.mockRestore();
  });

  const openModal = () => {
    act(() => {
      window.dispatchEvent(new Event("open-compose"));
    });
  };

  it("should render ComposeModal when open-compose event is triggered", () => {
    render(<ComposeModal />);
    expect(screen.queryByRole("dialog")).toBeNull();

    openModal();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("What's happening?")).toBeInTheDocument();
  });

  it("should have zero accessibility violations (jest-axe)", async () => {
    const { container } = render(<ComposeModal />);
    openModal();

    let results;
    await act(async () => {
      results = await axe(container);
    });

    expect(results).toHaveNoViolations();
  });

  it("should update character count and display remaining characters", () => {
    render(<ComposeModal />);
    openModal();

    const textarea = screen.getByPlaceholderText("What's happening?");
    fireEvent.change(textarea, { target: { value: "Hello linkora" } });

    // 280 - 13 = 267
    expect(screen.getByText("267")).toBeInTheDocument();
  });

  it("should close modal on Escape key press", () => {
    render(<ComposeModal />);
    openModal();

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("should trap focus inside the modal", () => {
    render(<ComposeModal />);
    openModal();

    const modal = screen.getByRole("dialog");
    const focusableSelectors =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusables = Array.from(modal.querySelectorAll<HTMLElement>(focusableSelectors)).filter(
      (el) => !el.hasAttribute("disabled")
    );

    expect(focusables.length).toBeGreaterThan(0);
    const lastElement = focusables[focusables.length - 1];

    lastElement.focus();
    expect(document.activeElement).toBe(lastElement);
  });
});
