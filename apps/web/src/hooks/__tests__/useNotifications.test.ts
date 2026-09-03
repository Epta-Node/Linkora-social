import { renderHook, act } from "@testing-library/react";
import { useNotifications } from "../useNotifications";
import { useNotificationsContext } from "@/contexts/NotificationsContext";
import { useWalletContext } from "@/components/WalletProvider";

jest.mock("@/contexts/NotificationsContext", () => ({
  useNotificationsContext: jest.fn(),
}));
jest.mock("@/components/WalletProvider", () => ({
  useWalletContext: jest.fn(),
}));

const mockUseNotificationsContext =
  useNotificationsContext as jest.MockedFunction<typeof useNotificationsContext>;
const mockUseWalletContext = useWalletContext as jest.MockedFunction<
  typeof useWalletContext
>;

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((ev: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = jest.fn();
  close = jest.fn();
}

beforeEach(() => {
  (globalThis as any).WebSocket = FakeWebSocket;
  window.localStorage.clear();
  mockUseWalletContext.mockReturnValue({
    address: "GBTEST0000000000000000000000000000000000000000000000000000",
    connected: true,
  });
  mockUseNotificationsContext.mockReturnValue({
    unreadCount: 2,
    incrementUnread: jest.fn(),
    decrementUnread: jest.fn(),
    resetUnread: jest.fn(),
    addNotification: jest.fn(),
    updateNotification: jest.fn(),
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

const ADDR = "GBTEST0000000000000000000000000000000000000000000000000000";
const ITEM = {
  id: "n1",
  type: "follow",
  actor: "GBACTOR111AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  timestamp: new Date().toISOString(),
  read: false,
};

function seedUnread() {
  window.localStorage.setItem(
    `linkora:notifications:items:${ADDR}`,
    JSON.stringify([ITEM])
  );
  window.localStorage.setItem("linkora:notifications:unread", "2");
}

describe("useNotifications markRead (#1306)", () => {
  it("does not clear unread state just by mounting", () => {
    seedUnread();
    const { result } = renderHook(() => useNotifications());

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].read).toBe(false);
    expect(mockUseNotificationsContext().resetUnread).not.toHaveBeenCalled();
  });

  it("marks a single notification read and decrements the unread counter", () => {
    seedUnread();
    const decrementUnread = jest.fn();
    mockUseNotificationsContext.mockReturnValue({
      ...mockUseNotificationsContext(),
      decrementUnread,
    });

    const { result } = renderHook(() => useNotifications());
    act(() => {
      result.current.markRead("n1");
    });

    expect(result.current.notifications[0].read).toBe(true);
    expect(decrementUnread).toHaveBeenCalledTimes(1);
    expect(mockUseNotificationsContext().resetUnread).not.toHaveBeenCalled();
  });

  it("does not decrement again for an already-read notification", () => {
    seedUnread();
    const decrementUnread = jest.fn();
    mockUseNotificationsContext.mockReturnValue({
      ...mockUseNotificationsContext(),
      decrementUnread,
    });

    const { result } = renderHook(() => useNotifications());
    act(() => {
      result.current.markRead("n1");
    });
    act(() => {
      result.current.markRead("n1");
    });

    expect(decrementUnread).toHaveBeenCalledTimes(1);
  });
});
