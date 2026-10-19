import { render, screen, fireEvent } from "@testing-library/react";
import NotificationsPage from "../notifications/page";
import { useNotifications } from "@/hooks/useNotifications";
import { useWalletContext } from "@/components/WalletProvider";

jest.mock("@/hooks/useNotifications", () => ({ useNotifications: jest.fn() }));
jest.mock("@/components/WalletProvider", () => ({ useWalletContext: jest.fn() }));

const ACTOR = "GBACTOR111AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function state(overrides: Record<string, unknown> = {}) {
  const value = {
    notifications: [],
    hasMore: false,
    unreadCount: 0,
    status: "idle",
    error: null,
    markAllPending: false,
    markAllError: null,
    markAllRead: jest.fn(),
    markRead: jest.fn(),
    loadMore: jest.fn(),
    retry: jest.fn(),
    ...overrides,
  };
  (useNotifications as jest.Mock).mockReturnValue(value);
  return value;
}

const item = (id: string, read = false) => ({
  id,
  type: "follow",
  actor: ACTOR,
  timestamp: new Date().toISOString(),
  read,
});

beforeEach(() => {
  (useWalletContext as jest.Mock).mockReturnValue({ address: "GME", connected: true });
});

describe("NotificationsPage (#1632)", () => {
  it("shows the empty state once loaded with no items", () => {
    state();
    render(<NotificationsPage />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.queryByTestId("mark-all-read")).not.toBeInTheDocument();
  });

  it("shows a loading placeholder instead of the empty state on first load", () => {
    state({ status: "loading" });
    render(<NotificationsPage />);
    expect(screen.getByLabelText("Loading notifications")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();
  });

  it("shows an error state with retry when the first page fails", () => {
    const s = state({ status: "error", error: "Could not load notifications (HTTP 503)" });
    render(<NotificationsPage />);
    expect(screen.getByTestId("error-state")).toHaveTextContent("HTTP 503");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(s.retry).toHaveBeenCalled();
  });

  it("keeps loaded items visible when a later page fails", () => {
    const s = state({
      notifications: [item("follow:a")],
      status: "error",
      error: "Network down",
      hasMore: true,
    });
    render(<NotificationsPage />);
    expect(screen.getAllByTestId("notification-item")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Network down");
    expect(screen.queryByTestId("load-more")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(s.retry).toHaveBeenCalled();
  });

  it("offers mark-all-read only while something is unread", () => {
    const s = state({ notifications: [item("follow:a"), item("follow:b", true)], unreadCount: 1 });
    render(<NotificationsPage />);
    fireEvent.click(screen.getByTestId("mark-all-read"));
    expect(s.markAllRead).toHaveBeenCalled();
  });

  it("disables mark-all-read while pending and reports a failed attempt", () => {
    state({
      notifications: [item("follow:a")],
      unreadCount: 1,
      markAllPending: true,
      markAllError: "HTTP 500",
    });
    render(<NotificationsPage />);
    expect(screen.getByTestId("mark-all-read")).toBeDisabled();
    expect(screen.getByTestId("mark-all-error")).toHaveTextContent("left unread");
  });

  it("loads more with the cursor-backed loader and disables the button while fetching", () => {
    const s = state({ notifications: [item("follow:a")], hasMore: true });
    const { rerender } = render(<NotificationsPage />);
    fireEvent.click(screen.getByTestId("load-more"));
    expect(s.loadMore).toHaveBeenCalled();

    state({ notifications: [item("follow:a")], hasMore: true, status: "loading-more" });
    rerender(<NotificationsPage />);
    expect(screen.getByTestId("load-more")).toBeDisabled();
    expect(screen.getByTestId("load-more")).toHaveTextContent("Loading…");
  });
});
