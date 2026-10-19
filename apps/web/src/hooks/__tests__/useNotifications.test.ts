import { renderHook, act, waitFor } from "@testing-library/react";
import { useNotifications } from "../useNotifications";
import { signedIndexerFetch } from "@/services/pushNotification";
import { useNotificationsContext } from "@/contexts/NotificationsContext";
import { useWalletContext } from "@/components/WalletProvider";

jest.mock("@/contexts/NotificationsContext", () => ({
  useNotificationsContext: jest.fn(),
}));
jest.mock("@/components/WalletProvider", () => ({
  useWalletContext: jest.fn(),
}));
jest.mock("@/services/pushNotification", () => ({
  signedIndexerFetch: jest.fn(),
}));

const mockSignedFetch = signedIndexerFetch as jest.MockedFunction<typeof signedIndexerFetch>;

const mockUseNotificationsContext = useNotificationsContext as jest.MockedFunction<
  typeof useNotificationsContext
>;
const mockUseWalletContext = useWalletContext as jest.MockedFunction<typeof useWalletContext>;

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
  window.localStorage.setItem(`linkora:notifications:items:${ADDR}`, JSON.stringify([ITEM]));
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

  it("does not construct any WebSocket connection on mount (#1583)", () => {
    const wsConstructorSpy = jest.fn();
    (globalThis as any).WebSocket = wsConstructorSpy;
    renderHook(() => useNotifications());
    expect(wsConstructorSpy).not.toHaveBeenCalled();
  });
});

// ── Indexer inbox: cursor pagination + mark-all-read (#1632) ──────────────────

const ACTOR = "GBACTOR111AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function apiItem(id: string, minutesAgo: number, read = false) {
  return {
    id,
    type: "like",
    actor: ACTOR,
    post_id: 7,
    amount: null,
    excerpt: "hello",
    created_at: new Date(Date.UTC(2026, 4, 1, 12, 0) - minutesAgo * 60_000).toISOString(),
    read,
  };
}

function page(items: ReturnType<typeof apiItem>[], nextCursor: string | null) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      notifications: items,
      has_more: nextCursor !== null,
      next_cursor: nextCursor,
    }),
  } as Response;
}

function contextWith(overrides: Record<string, unknown> = {}) {
  const value = {
    unreadCount: 0,
    incrementUnread: jest.fn(),
    decrementUnread: jest.fn(),
    resetUnread: jest.fn(),
    addNotification: jest.fn(),
    updateNotification: jest.fn(),
    notifications: [],
    ...overrides,
  };
  mockUseNotificationsContext.mockReturnValue(value as never);
  return value;
}

describe("useNotifications inbox API (#1632)", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    delete (globalThis as any).fetch;
  });

  it("loads the first page and merges it with cached items without duplicates", async () => {
    window.localStorage.setItem(
      `linkora:notifications:items:${ADDR}`,
      JSON.stringify([{ ...ITEM, id: "like:7:" + ACTOR, timestamp: apiItem("x", 1).created_at }])
    );
    fetchMock.mockResolvedValueOnce(
      page([apiItem("like:7:" + ACTOR, 1), apiItem("tip:abc", 5)], null)
    );
    contextWith();

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.notifications.map((n) => n.id)).toEqual(["like:7:" + ACTOR, "tip:abc"]);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `http://localhost:3001/api/notifications/inbox/${ADDR}?limit=20`
    );
    expect(result.current.hasMore).toBe(false);
  });

  it("loads more with the cursor and never duplicates overlapping items", async () => {
    fetchMock
      .mockResolvedValueOnce(page([apiItem("a", 1), apiItem("b", 2)], "CURSOR_1"))
      .mockResolvedValueOnce(page([apiItem("b", 2), apiItem("c", 3)], null));
    contextWith();

    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.hasMore).toBe(false));

    expect(fetchMock.mock.calls[1][0]).toContain("cursor=CURSOR_1");
    expect(result.current.notifications.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("dedupes items that arrived live over the WebSocket", async () => {
    fetchMock.mockResolvedValueOnce(page([apiItem("follow:" + ACTOR, 1)], null));
    contextWith({
      notifications: [
        {
          id: "follow:" + ACTOR,
          type: "follow",
          actor: ACTOR,
          timestamp: apiItem("x", 1).created_at,
          read: false,
        },
      ],
    });

    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.status).toBe("idle"));

    expect(result.current.notifications).toHaveLength(1);
  });

  it("marks all as read optimistically and keeps it when the API succeeds", async () => {
    fetchMock.mockResolvedValueOnce(page([apiItem("a", 1), apiItem("b", 2, true)], null));
    let resolveApi: (value: Response) => void = () => {};
    mockSignedFetch.mockReturnValueOnce(new Promise((resolve) => (resolveApi = resolve)));
    const ctx = contextWith();

    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.unreadCount).toBe(1));

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.markAllRead();
    });

    // Optimistic: list and badge update before the request settles.
    expect(result.current.notifications.every((n) => n.read)).toBe(true);
    expect(ctx.resetUnread).toHaveBeenCalledTimes(1);
    expect(result.current.markAllPending).toBe(true);
    expect(mockSignedFetch).toHaveBeenCalledWith(ADDR, "/api/notifications/inbox/read-all", {
      method: "POST",
    });

    await act(async () => {
      resolveApi({ ok: true, status: 200 } as Response);
      await pending;
    });
    expect(result.current.markAllPending).toBe(false);
    expect(result.current.notifications.every((n) => n.read)).toBe(true);
    expect(ctx.incrementUnread).not.toHaveBeenCalled();
  });

  it("rolls back the list and badge when mark-all-read fails", async () => {
    fetchMock.mockResolvedValueOnce(
      page([apiItem("a", 1), apiItem("b", 2), apiItem("c", 3, true)], null)
    );
    mockSignedFetch.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    const ctx = contextWith();

    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.unreadCount).toBe(2));

    await act(async () => {
      await result.current.markAllRead();
    });

    expect(result.current.notifications.map((n) => [n.id, n.read])).toEqual([
      ["a", false],
      ["b", false],
      ["c", true],
    ]);
    expect(ctx.resetUnread).toHaveBeenCalledTimes(1);
    expect(ctx.incrementUnread).toHaveBeenCalledTimes(2);
    expect(result.current.markAllError).toMatch(/HTTP 500/);
  });

  it("exposes an error state and retries the failed page", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as Response)
      .mockResolvedValueOnce(page([apiItem("a", 1)], null));
    contextWith();

    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatch(/HTTP 503/);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.notifications.map((n) => n.id)).toEqual(["a"]);
  });
});
