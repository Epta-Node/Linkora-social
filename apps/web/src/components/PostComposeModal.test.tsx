import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { PostComposeModal } from "./PostComposeModal";

const mockPush = jest.fn();
const mockOnClose = jest.fn();
const mockSignTransaction = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@stellar/freighter-api", () => ({
  signTransaction: (...args: unknown[]) => mockSignTransaction(...args),
}));

const mockGetAccount = jest.fn();
const mockSimulateTransaction = jest.fn();
const mockSendTransaction = jest.fn();
const mockGetTransaction = jest.fn();

jest.mock("@stellar/stellar-sdk", () => {
  const mockBuild = jest.fn().mockReturnValue({ toXDR: () => "mock-xdr" });
  const mockAssembleTx = jest.fn().mockReturnValue({ build: mockBuild });
  return {
    BASE_FEE: "100",
    TransactionBuilder: Object.assign(
      jest.fn().mockImplementation(() => ({
        addOperation: jest.fn().mockReturnThis(),
        setTimeout: jest.fn().mockReturnThis(),
        build: mockBuild,
      })),
      {
        fromXDR: jest.fn().mockReturnValue({ toXDR: () => "mock-signed-xdr" }),
      }
    ),
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn().mockReturnValue("mock-op"),
    })),
    Address: {
      fromString: jest.fn().mockReturnValue({ toScVal: () => "mock-scval" }),
    },
    nativeToScVal: jest.fn().mockReturnValue("mock-scval"),
    scValToNative: jest.fn().mockReturnValue(BigInt(42)),
    rpc: {
      Server: jest.fn().mockImplementation(() => ({
        getAccount: mockGetAccount,
        simulateTransaction: mockSimulateTransaction,
        sendTransaction: mockSendTransaction,
        getTransaction: mockGetTransaction,
      })),
      assembleTransaction: mockAssembleTx,
      Api: {
        isSimulationError: jest.fn().mockReturnValue(false),
      },
    },
  };
});

const MOCK_PUBLIC_KEY = "GBRPYHIL2CI3WHZDTOOQFC6EB4RBIGSJRVSBUOYS77TQ7CQK5FHQ6SR";

function renderModal(isOpen = true) {
  return render(
    <PostComposeModal isOpen={isOpen} onClose={mockOnClose} publicKey={MOCK_PUBLIC_KEY} />
  );
}

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  mockGetAccount.mockResolvedValue({ sequence: "1" });
  mockSimulateTransaction.mockResolvedValue({});
  mockSendTransaction.mockResolvedValue({
    status: "PENDING",
    hash: "tx-hash-123",
  });
  mockGetTransaction.mockResolvedValue({
    status: "SUCCESS",
    returnValue: BigInt(42),
  });
  mockSignTransaction.mockResolvedValue("signed-xdr-string");
});

afterEach(() => {
  jest.useRealTimers();
});

describe("PostComposeModal", () => {
  it("does not render when isOpen is false", () => {
    renderModal(false);
    expect(screen.queryByText("Compose Post")).not.toBeInTheDocument();
  });

  it("renders composer editor and submit button when open", () => {
    const { container } = renderModal(true);
    expect(screen.getByText("Compose Post")).toBeInTheDocument();
    expect(container.querySelector(".composer-editor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Post" })).toBeInTheDocument();
  });

  it("disables submit button when content is empty", () => {
    renderModal(true);
    const submitBtn = screen.getByRole("button", { name: "Post" });
    expect(submitBtn).toBeDisabled();
  });

  it("calls signTransaction and transitions through signing states", async () => {
    const { container } = renderModal(true);
    const editor = container.querySelector(".composer-editor")!;

    editor.textContent = "Test post";
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    expect(screen.getByText("Waiting for Freighter wallet signing...")).toBeInTheDocument();

    await waitFor(() => {
      expect(mockSignTransaction).toHaveBeenCalledWith(
        "mock-xdr",
        expect.objectContaining({ networkPassphrase: expect.any(String) })
      );
    });

    await waitFor(() => {
      expect(
        screen.getByText("Submitting transaction to Stellar blockchain...")
      ).toBeInTheDocument();
    });
  });

  it("displays success state and redirects after successful publish", async () => {
    jest.useFakeTimers();

    mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "tx-hash-123" });
    mockGetTransaction.mockResolvedValue({ status: "SUCCESS", returnValue: BigInt(42) });

    const { container } = renderModal(true);
    const editor = container.querySelector(".composer-editor")!;

    editor.textContent = "New post";
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => {
      expect(mockSignTransaction).toHaveBeenCalled();
    });

    jest.advanceTimersByTime(1500);

    await waitFor(() => {
      expect(screen.getByText("Post published successfully! Redirecting...")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /view on stellar expert/i })).toHaveAttribute(
        "href",
        "https://stellar.expert/explorer/testnet/tx/tx-hash-123"
      );
    });

    jest.advanceTimersByTime(2000);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/posts/42");
    });

    jest.useRealTimers();
  });

  it("displays error state when submission fails", async () => {
    mockSendTransaction.mockRejectedValue(new Error("Network timeout"));

    const { container } = renderModal(true);
    const editor = container.querySelector(".composer-editor")!;

    editor.textContent = "Fail post";
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => {
      expect(screen.getByText("Network timeout")).toBeInTheDocument();
      expect(screen.getByText("Try Again")).toBeInTheDocument();
    });
  });
});
