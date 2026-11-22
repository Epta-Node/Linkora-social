import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import DirectMessagePage from "@/app/dm/[address]/page";
import { fetchRelayMessages, onRelayMessage, type RelayMessage } from "@/lib/dm/relay";

const ME = "GMEMEMEMEMEMEMEMEMEMEMEMEMEMEMEMEMEMEMEMEMEMEMEMEMEMEMEM";
const THEM = "GTHEMTHEMTHEMTHEMTHEMTHEMTHEMTHEMTHEMTHEMTHEMTHEMTHEMTHEM";

jest.mock("next/navigation", () => ({
  useParams: () => ({ address: THEM }),
  useRouter: () => ({ back: jest.fn() }),
}));
jest.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({ address: ME, connected: true }),
}));
jest.mock("@/lib/dm/storage", () => ({
  hasDmKeypair: () => true,
  storeDmKeypair: jest.fn(),
  loadDmKeypair: jest
    .fn()
    .mockResolvedValue({ privateKey: new Uint8Array(32), publicKey: new Uint8Array(32) }),
}));
jest.mock("@/lib/dm/contract", () => ({
  getDmKey: jest.fn().mockResolvedValue(new Uint8Array(32)),
  publishDmKey: jest.fn(),
}));
jest.mock("@/lib/dm/crypto", () => ({
  generateDmKeypair: jest.fn(),
  encryptDirectMessage: jest.fn(),
  // the "ciphertext" in these tests is just the plain text
  decryptDirectMessage: (_k: unknown, _p: unknown, _a: unknown, _b: unknown, bytes: string) =>
    bytes,
  base64ToBytes: (s: string) => s,
  DecryptionError: class extends Error {},
}));
jest.mock("@/lib/dm/relay", () => ({
  sendRelayMessage: jest.fn(),
  fetchRelayMessages: jest.fn(),
  connectRelayWs: jest.fn(),
  onRelayMessage: jest.fn(),
  sendTypingStatus: jest.fn(),
}));

const msg = (id: number, sender: string, text: string) =>
  ({
    id,
    sender,
    ciphertext_b64: text,
    message_index: id,
    timestamp: 1_700_000_000 + id,
  }) as unknown as RelayMessage;

describe("DM page accessibility", () => {
  let push: (payload: unknown) => void = () => {};

  beforeEach(() => {
    (onRelayMessage as jest.Mock).mockImplementation((cb: (payload: unknown) => void) => {
      push = cb;
      return () => {};
    });
    (fetchRelayMessages as jest.Mock).mockResolvedValue([msg(1, THEM, "hi"), msg(2, ME, "hello")]);
  });

  it("labels the input and keeps the send button focusable with an accessible name", async () => {
    render(<DirectMessagePage />);
    expect(await screen.findByLabelText("Message input")).toBeInTheDocument();
    const send = screen.getByRole("button", { name: "Send message" });
    expect(send).not.toBeDisabled();
    expect(send).toHaveAttribute("aria-disabled", "true");
    send.focus();
    expect(send).toHaveFocus();
  });

  it("moves focus between messages with the arrow keys", async () => {
    render(<DirectMessagePage />);
    const list = await screen.findByRole("log");
    await waitFor(() => expect(list.querySelectorAll("li")).toHaveLength(2));
    const [first, second] = Array.from(list.querySelectorAll("li"));

    list.focus();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(list, { key: "Home" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(list, { key: "End" });
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("aria-label", expect.stringContaining("You at"));
  });

  it("announces a newly received message to screen readers", async () => {
    render(<DirectMessagePage />);
    await waitFor(() => expect(screen.getByRole("log").querySelectorAll("li")).toHaveLength(2));
    const announcer = screen.getByTestId("dm-announcer");
    expect(announcer).toHaveAttribute("aria-live", "polite");
    expect(announcer).toBeEmptyDOMElement();

    (fetchRelayMessages as jest.Mock).mockResolvedValue([
      msg(1, THEM, "hi"),
      msg(2, ME, "hello"),
      msg(3, THEM, "are you there?"),
    ]);
    await act(async () => {
      push({ type: "new_message", sender: THEM });
    });
    await waitFor(() => expect(announcer).toHaveTextContent("New message: are you there?"));
  });
});
