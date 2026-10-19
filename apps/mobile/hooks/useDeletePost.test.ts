import { renderHook, act } from "@testing-library/react-native";
import { useDeletePost } from "./useDeletePost";
import { useToast } from "../context/ToastContext";
import { useWallet } from "./useWallet";
import { markFeedPostDeleted } from "./useFeed";

jest.mock("../context/ToastContext", () => ({
  useToast: jest.fn(),
}));

jest.mock("./useWallet", () => ({
  useWallet: jest.fn(),
}));

jest.mock("./useFeed", () => ({
  markFeedPostDeleted: jest.fn(),
}));

const showError = jest.fn();
const showPending = jest.fn();
const showSuccess = jest.fn();

(useToast as jest.Mock).mockReturnValue({ showError, showPending, showSuccess });

describe("useDeletePost authorization gating (#1206)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useToast as jest.Mock).mockReturnValue({ showError, showPending, showSuccess });
  });

  it("does not allow a non-author to delete a post", async () => {
    (useWallet as jest.Mock).mockReturnValue({
      address: "GALICEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      connected: true,
    });

    const { result } = renderHook(() => useDeletePost());

    let deleted: boolean | undefined;
    await act(async () => {
      deleted = await result.current.deletePost({
        postId: 1,
        author: "GBOBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      });
    });

    expect(deleted).toBe(false);
    expect(result.current.error).toBe("Only the post author can delete this post.");
    expect(showError).toHaveBeenCalledWith("Only the post author can delete this post.");
    expect(markFeedPostDeleted).not.toHaveBeenCalled();
  });

  it("does not allow an anonymous viewer to delete a post", async () => {
    (useWallet as jest.Mock).mockReturnValue({
      address: null,
      connected: false,
    });

    const { result } = renderHook(() => useDeletePost());

    let deleted: boolean | undefined;
    await act(async () => {
      deleted = await result.current.deletePost({
        postId: 1,
        author: "GALICEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      });
    });

    expect(deleted).toBe(false);
    expect(result.current.error).toBe("Connect your wallet to delete this post.");
    expect(showError).toHaveBeenCalledWith("Connect your wallet to delete this post.");
    expect(markFeedPostDeleted).not.toHaveBeenCalled();
  });

  it("allows the author to delete their own post", async () => {
    (useWallet as jest.Mock).mockReturnValue({
      address: "GALICEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      connected: true,
    });

    const { result } = renderHook(() => useDeletePost());

    let deleted: boolean | undefined;
    await act(async () => {
      deleted = await result.current.deletePost({
        postId: 1,
        author: "GALICEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      });
    });

    expect(deleted).toBe(true);
    expect(markFeedPostDeleted).toHaveBeenCalledWith("1");
  });
});
