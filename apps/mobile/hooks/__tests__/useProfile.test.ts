/**
 * #1862 — pull-to-refresh re-fetches the profile and follow counts without
 * dropping back to the full-screen loading state.
 */
import { act, renderHook, waitFor } from "@testing-library/react-native";

const mockFollowers = { users: [{ address: "GA" }], refresh: jest.fn() };
const mockFollowing = { users: [] as { address: string }[], refresh: jest.fn() };

jest.mock("../useFollowers", () => ({ useFollowers: () => mockFollowers }));
jest.mock("../useFollowing", () => ({ useFollowing: () => mockFollowing }));
jest.mock("../useWallet", () => ({ useWallet: () => ({ address: "GME" }) }));
jest.mock("../useSubmitTx", () => ({ useSubmitTx: () => jest.fn() }));
jest.mock("../../context/ToastContext", () => ({ useToast: () => ({ showError: jest.fn() }) }));

import { useProfile } from "../useProfile";

describe("useProfile refresh (#1862)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("refreshes profile and follow counts while keeping the profile on screen", async () => {
    const { result } = renderHook(() => useProfile("GPROFILEADDRESS"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile?.address).toBe("GPROFILEADDRESS");

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.refresh();
    });
    expect(result.current.refreshing).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.profile).not.toBeNull();
    // followers, following, and my own following list
    expect(mockFollowers.refresh).toHaveBeenCalledTimes(1);
    expect(mockFollowing.refresh).toHaveBeenCalledTimes(2);

    await act(async () => {
      await pending;
    });
    expect(result.current.refreshing).toBe(false);
  });
});
