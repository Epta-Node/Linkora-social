import React, { useState } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NotificationsProvider, useNotificationsContext } from "./NotificationsContext";

// Mock the wallet context so the provider has no address (which keeps the
// indexer WebSocket effect from firing in the test environment).
jest.mock("@/components/WalletProvider", () => ({
  ...jest.requireActual("@/components/WalletProvider"),
  useWalletContext: () => ({ address: null }),
}));

function NotificationTestComponent() {
  const {
    addNotification,
    getNotification,
    updateNotification,
    actionNotifications,
    unreadCount,
    inboxUnreadCount,
  } = useNotificationsContext();
  const [ids, setIds] = useState<string[]>([]);

  const handleAdd = () => {
    const id = addNotification({ status: "pending", message: `message-${ids.length}` });
    setIds((prev) => [...prev, id]);
  };

  const handleUpdate = (id: string) => {
    updateNotification(id, {
      status: "success",
      message: "Post published!",
      txHash: "0xabc123",
    });
  };

  const resolved = (id: string) => getNotification(id);

  return (
    <div>
      <button data-testid="add" onClick={handleAdd}>
        Add
      </button>
      <div data-testid="action-count">{actionNotifications.length}</div>
      <div data-testid="unread">{unreadCount}</div>
      <div data-testid="inbox-unread">{inboxUnreadCount}</div>
      {ids.map((id, idx) => {
        const current = resolved(id);
        return (
          <div key={id} data-testid={`row-${idx}`}>
            <span data-testid={`id-${idx}`}>{current?.id ?? "none"}</span>
            <span data-testid={`status-${idx}`}>{current?.status ?? "none"}</span>
            <span data-testid={`message-${idx}`}>{current?.message ?? "none"}</span>
            <span data-testid={`txhash-${idx}`}>{current?.txHash ?? "none"}</span>
            <button data-testid={`update-${idx}`} onClick={() => handleUpdate(id)}>
              Update {idx}
            </button>
          </div>
        );
      })}
    </div>
  );
}

describe("NotificationsContext", () => {
  const renderComponent = () =>
    render(
      <NotificationsProvider>
        <NotificationTestComponent />
      </NotificationsProvider>
    );

  it("round-trips a notification through add -> get -> update", () => {
    renderComponent();

    // add
    fireEvent.click(screen.getByTestId("add"));
    expect(screen.getByTestId("action-count")).toHaveTextContent("1");
    expect(screen.getByTestId("status-0")).toHaveTextContent("pending");
    expect(screen.getByTestId("message-0")).toHaveTextContent("message-0");

    // the returned id must be the one retrievable via getNotification
    const returnedId = screen.getByTestId("id-0").textContent;
    expect(returnedId).toMatch(/^notification-/);
    expect(returnedId).not.toBe("none");

    // pending add should not increment the unread badge
    expect(screen.getByTestId("unread")).toHaveTextContent("0");

    // update
    fireEvent.click(screen.getByTestId("update-0"));

    // the same id now resolves to the mutated record
    expect(screen.getByTestId("action-count")).toHaveTextContent("1");
    expect(screen.getByTestId("id-0")).toHaveTextContent(returnedId!);
    expect(screen.getByTestId("status-0")).toHaveTextContent("success");
    expect(screen.getByTestId("message-0")).toHaveTextContent("Post published!");
    expect(screen.getByTestId("txhash-0")).toHaveTextContent("0xabc123");

    // transitioning away from pending bumps the unread badge
    expect(screen.getByTestId("unread")).toHaveTextContent("1");
  });

  it("returns distinct ids and updating one does not touch the other", () => {
    renderComponent();

    fireEvent.click(screen.getByTestId("add"));
    const firstId = screen.getByTestId("id-0").textContent;
    fireEvent.click(screen.getByTestId("add"));
    const secondId = screen.getByTestId("id-1").textContent;

    expect(firstId).not.toBe(secondId);
    expect(screen.getByTestId("action-count")).toHaveTextContent("2");

    // update only the second notification
    fireEvent.click(screen.getByTestId("update-1"));
    expect(screen.getByTestId("status-1")).toHaveTextContent("success");
    expect(screen.getByTestId("status-0")).toHaveTextContent("pending");
    expect(screen.getByTestId("action-count")).toHaveTextContent("2");

    // the first record is still retrievable and untouched
    expect(screen.getByTestId("id-0")).toHaveTextContent(firstId!);
    expect(screen.getByTestId("message-0")).toHaveTextContent("message-0");
  });

  it("updating an unknown id is a harmless no-op", () => {
    renderComponent();

    // grab updateNotification out of the live provider via a second consumer
    let updateUnknown: () => void = () => {};
    let rendered = 0;
    function Probe() {
      const { updateNotification, addNotification } = useNotificationsContext();
      rendered += 1;
      updateUnknown = () => updateNotification("does-not-exist", { status: "error" });
      return (
        <button
          data-testid="probe-add"
          onClick={() => {
            const id = addNotification({ status: "pending", message: "p" });
            updateNotification(id, { status: "success" });
          }}
        >
          probe
        </button>
      );
    }
    render(
      <NotificationsProvider>
        <Probe />
      </NotificationsProvider>
    );

    expect(rendered).toBeGreaterThan(0);
    expect(() => act(() => updateUnknown())).not.toThrow();
  });
});
