import { submitPost } from "./CreatePost";

describe("submitPost", () => {
  beforeEach(() => {
    // @ts-ignore
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("submits post payload to API and returns confirmed post ID", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 42,
        transactionHash: "0x123abc...",
        timestamp: 1690000000,
      }),
    });

    const result = await submitPost({
      content: "Hello Stellar Soroban!",
      author: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    });

    expect(global.fetch).toHaveBeenCalledWith("http://localhost:3001/api/posts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: "Hello Stellar Soroban!",
        author: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      }),
    });

    expect(result.id).toBe(42);
    expect(result.transactionHash).toBe("0x123abc...");
  });

  it("throws error when API returns failure status", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      statusText: "Internal Server Error",
    });

    await expect(
      submitPost({
        content: "Failed post",
        author: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      })
    ).rejects.toThrow("Failed to submit post: Internal Server Error");
  });
});
