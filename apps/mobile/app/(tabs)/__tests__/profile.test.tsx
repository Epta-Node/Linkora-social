/**
 * #1595 — profile tab accessibility metadata and clipboard error handling.
 */
import { AccessibilityInfo } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";

jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn(),
}));

jest.mock("../../../hooks/useWallet", () => ({
  useWallet: jest.fn(),
}));

jest.mock("../../../hooks/useProfile", () => ({
  useProfile: jest.fn(),
}));

jest.mock("../../../hooks/useNetwork", () => ({
  useNetwork: jest.fn(),
}));

import { useWallet } from "../../../hooks/useWallet";
import { useProfile } from "../../../hooks/useProfile";
import { useNetwork } from "../../../hooks/useNetwork";
import { ToastProvider } from "../../../context/ToastContext";
import ProfileScreen from "../profile";

const mockedUseWallet = useWallet as jest.Mock;
const mockedUseProfile = useProfile as jest.Mock;
const mockedUseNetwork = useNetwork as jest.Mock;
const mockedSetStringAsync = Clipboard.setStringAsync as jest.Mock;

const ADDRESS = "G" + "A".repeat(55);

function renderScreen() {
  return render(
    <ToastProvider>
      <ProfileScreen />
    </ToastProvider>
  );
}

function setConnected(connected: boolean) {
  mockedUseWallet.mockReturnValue({
    address: connected ? ADDRESS : null,
    connected,
    connect: jest.fn(),
    disconnect: jest.fn(),
    error: null,
    refresh: jest.fn(),
  });
}

describe("Profile tab accessibility (#1595)", () => {
  let announceSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    announceSpy = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => undefined);
    mockedUseNetwork.mockReturnValue({
      networkLabel: "Testnet",
      contractId: "CBLNKTESTNET",
      rpcUrl: "https://soroban-testnet.stellar.org",
    });
    mockedUseProfile.mockReturnValue({
      profile: { address: ADDRESS, username: "alice", bio: "hi" },
      loading: false,
      error: null,
      followerCount: 3,
      followingCount: 5,
      refresh: jest.fn(),
    });
    setConnected(true);
  });

  afterEach(() => {
    announceSpy.mockRestore();
  });

  it("gives every action a role and a descriptive label", () => {
    renderScreen();

    const copy = screen.getByRole("button", { name: "Copy wallet address" });
    expect(copy.props.accessibilityHint).toMatch(/clipboard/i);
    expect(screen.getByRole("button", { name: "Open settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect wallet" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit profile" })).toBeTruthy();
  });

  it("hides the decorative empty-state icon when disconnected", () => {
    setConnected(false);
    renderScreen();

    // includeHiddenElements: the point of the props is that AT cannot see it.
    const icon = screen.getByTestId("empty-state-icon", { includeHiddenElements: true });
    expect(icon.props.accessibilityElementsHidden).toBe(true);
    expect(icon.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeTruthy();
  });

  it("announces a clipboard failure instead of rejecting unhandled", async () => {
    mockedSetStringAsync.mockRejectedValue(new Error("clipboard unavailable"));
    renderScreen();

    fireEvent.press(screen.getByRole("button", { name: "Copy wallet address" }));

    await waitFor(() => expect(screen.getByText("Couldn't copy")).toBeTruthy());
    expect(announceSpy).toHaveBeenCalledWith(expect.stringContaining("Couldn't copy"));
  });

  it("copies the address and reports success", async () => {
    mockedSetStringAsync.mockResolvedValue(undefined);
    renderScreen();

    fireEvent.press(screen.getByRole("button", { name: "Copy wallet address" }));

    await waitFor(() => expect(screen.getByText("Copied!")).toBeTruthy());
    expect(mockedSetStringAsync).toHaveBeenCalledWith(ADDRESS);
    // Success is not an error: nothing needs an explicit announcement.
    expect(announceSpy).not.toHaveBeenCalled();
  });

  it("reports a disconnect failure to the user", async () => {
    const disconnect = jest.fn().mockRejectedValue(new Error("keychain unavailable"));
    mockedUseWallet.mockReturnValue({
      address: ADDRESS,
      connected: true,
      connect: jest.fn(),
      disconnect,
      error: null,
      refresh: jest.fn(),
    });
    renderScreen();

    fireEvent.press(screen.getByRole("button", { name: "Disconnect wallet" }));

    await waitFor(() => expect(screen.getByText("Disconnect failed")).toBeTruthy());
    expect(announceSpy).toHaveBeenCalledWith(expect.stringContaining("Disconnect failed"));
  });
});
